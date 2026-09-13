"""
The acceptance scenario from the requirements document, end to end, plus the
rules that protect a shop's data. Nothing here touches a network.
"""
import shutil
import unittest
from pathlib import Path

from tests.helpers import call, fresh_database

from medv import api, db, paths
from medv.util.dates import add_months, today
from medv.util.money import r2


def expiry_in(months: int) -> str:
    return add_months(today(), months)[:7]


class OfflineAcceptanceTests(unittest.TestCase):
    """Steps 1–20 of 'IMPORTANT TEST' in the requirements, in order."""

    @classmethod
    def setUpClass(cls):
        cls.root = fresh_database()

    @classmethod
    def tearDownClass(cls):
        db.close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_01_first_launch_creates_the_admin_account(self):
        info = call("app.info")
        self.assertFalse(info["setup"]["complete"])
        self.assertEqual(info["setup"]["users"], 1)
        self.assertTrue(Path(info["paths"]["db"]).exists())
        self.assertEqual(call("auth.login", {"username": "admin", "password": "admin123"})["user"]["role"],
                         "admin")
        with self.assertRaises(Exception):
            call("auth.login", {"username": "admin", "password": "wrong"})

    def test_02_setup_wizard_replaces_the_default_password(self):
        result = call("setup.complete", {
            "store_name": "Vormir Medicals", "store_city": "Nagpur", "store_phone": "9226406057",
            "store_gstin": "27ABCDE1234F1Z5", "store_dl_no": "MH-NAG-20B-9988",
            "invoice_prefix": "VM", "admin_password": "shop@2026",
        })
        self.assertEqual(result["settings"]["store_name"], "Vormir Medicals")
        self.assertEqual(result["settings"]["setup_complete"], "1")
        with self.assertRaises(Exception):
            call("auth.login", {"username": "admin", "password": "admin123"})
        self.assertEqual(call("auth.login", {"username": "admin", "password": "shop@2026"})["user"]["username"],
                         "admin")

    def test_03_medicine_batch_purchase_and_stock(self):
        product = call("products.save", {
            "name": "Paracetamol 500mg Tablet", "generic": "Paracetamol", "manufacturer": "Cipla",
            "category": "Tablet", "pack_size": 10, "gst_rate": 12, "reorder_level": 20, "hsn": "3004"})
        self.assertEqual(product["stock_units"], 0)
        supplier = call("suppliers.save", {"name": "Nagpur Distributors", "gstin": "27ABCDE1234F1Z5"})
        purchase = call("purchases.create", {
            "supplier_id": supplier["id"], "ref_no": "SB-1001", "payment_mode": "Credit",
            "items": [{"product_id": product["id"], "batch_no": "PCM101", "expiry": expiry_in(18),
                       "mrp": 24.5, "qty_units": 100, "free_units": 10, "rate_per_unit": 1.6,
                       "disc_pct": 5, "gst_rate": 12}]})
        self.assertEqual(purchase["subtotal"], 152.0)
        self.assertEqual(purchase["gst_amount"], 18.24)
        self.assertEqual(purchase["total"], 170.0)
        # 100 bought plus 10 free
        stock = call("products.get", {"id": product["id"]})
        self.assertEqual(stock["stock_units"], 110)
        self.assertEqual(stock["stock_label"], "11 Strip")

    def test_04_sale_of_strips_and_loose_tablets(self):
        product = call("products.list", {"search": "Paracetamol"})[0]
        customer = call("customers.save", {"name": "Ramesh Patil", "phone": "9822012345"})
        doctors = call("doctors.save", {"name": "Dr. Deshmukh", "commission_pct": 2})
        batch = call("batches.list", {"product_id": product["id"]})[0]
        sale = call("sales.create", {
            "customer_id": customer["id"], "doctor_id": doctors[0]["id"], "payment_mode": "Cash",
            "reminder_days": 25,
            "items": [{"product_id": product["id"], "batch_id": batch["id"], "qty_units": 23,
                       "rate_per_unit": 2.45, "disc_pct": 0, "gst_rate": 12}]})
        # 2 strips + 3 tablets at 2.45 = 56.35 taxable, GST 6.76, 63.11 rounds to 63
        self.assertEqual(sale["no"], "VM-0001")
        self.assertEqual(sale["subtotal"], 56.35)
        self.assertEqual(sale["gst_amount"], 6.76)
        self.assertEqual(sale["total"], 63.0)
        self.assertEqual(sale["balance"], 0.0)
        self.assertEqual(sale["store"]["name"], "Vormir Medicals")
        self.assertEqual(len(sale["gst_summary"]), 1)
        self.assertEqual(call("products.get", {"id": product["id"]})["stock_units"], 87)
        self.assertEqual(call("accounts.balances")["cash"], 63.0)

    def test_05_data_survives_closing_and_reopening(self):
        db.close()
        db.open_db(paths.db_file())
        api.set_session({"id": 1, "username": "admin", "role": "admin", "name": "Administrator"})
        product = call("products.list", {"search": "Paracetamol"})[0]
        self.assertEqual(call("sales.list", {})["rows"][0]["total"], 63.0)
        self.assertEqual(call("products.get", {"id": product["id"]})["stock_units"], 87)

    def test_06_a_second_sale_on_credit_and_the_reports(self):
        product = call("products.list", {"search": "Paracetamol"})[0]
        customer = call("customers.list", {})[0]
        batch = call("batches.list", {"product_id": product["id"]})[0]
        credit = call("sales.create", {
            "customer_id": customer["id"], "payment_mode": "Credit",
            "items": [{"product_id": product["id"], "batch_id": batch["id"], "qty_units": 10,
                       "rate_per_unit": 2.45, "gst_rate": 12}]})
        self.assertEqual(credit["paid"], 0)
        self.assertEqual(credit["balance"], credit["total"])
        self.assertEqual(call("customers.get", {"id": customer["id"]})["balance"], credit["total"])

        register = call("reports.sales", {"from": today(), "to": today()})
        self.assertEqual(register["totals"]["bills"], 2)
        dashboard = call("reports.dashboard", {})
        self.assertEqual(dashboard["day"]["bills"], 2)
        self.assertEqual(dashboard["counts"]["products"], 1)
        self.assertEqual(dashboard["pendingRxCount"], 1)

    def test_07_backup_clear_and_restore(self):
        backup = call("backup.create", {})
        self.assertTrue(Path(backup["path"]).exists())
        self.assertGreater(backup["size"], 0)

        call("data.clear", {"confirm": True})
        self.assertEqual(len(call("sales.list", {})["rows"]), 0)
        product = call("products.list", {"search": "Paracetamol"})[0]
        self.assertEqual(call("products.get", {"id": product["id"]})["stock_units"], 0)

        info = call("backup.inspect", {"sourcePath": backup["path"]})
        self.assertEqual(info["counts"]["sales"], 2)
        restored = call("backup.restore", {"sourcePath": backup["path"], "confirm": True})
        self.assertTrue(restored["ok"])
        self.assertTrue(Path(restored["safetyCopy"]).exists())

        api.set_session({"id": 1, "username": "admin", "role": "admin", "name": "Administrator"})
        self.assertEqual(len(call("sales.list", {})["rows"]), 2)
        self.assertEqual(call("products.get", {"id": product["id"]})["stock_units"], 77)
        self.assertEqual(call("accounts.balances")["cash"], 63.0)


class DataSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = fresh_database()
        call("setup.complete", {"store_name": "Test Chemist", "admin_password": "shop@2026"})
        cls.admin = call("auth.login", {"username": "admin", "password": "shop@2026"})["user"]
        cls.product = call("products.save", {"name": "Paracetamol", "pack_size": 10, "gst_rate": 12})
        cls.batch = call("batches.save", {"product_id": cls.product["id"], "batch_no": "B1",
                                          "expiry": expiry_in(18), "mrp": 24.5,
                                          "rate_per_unit": 1.6, "qty_units": 100})

    @classmethod
    def tearDownClass(cls):
        db.close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def setUp(self):
        api.set_session(self.admin)

    def test_a_failed_sale_rolls_back_completely(self):
        before = call("products.get", {"id": self.product["id"]})["stock_units"]
        bills = len(call("sales.list", {})["rows"])
        cash = call("accounts.balances")["cash"]
        with self.assertRaisesRegex(Exception, "Not enough stock"):
            call("sales.create", {"payment_mode": "Cash", "items": [
                {"product_id": self.product["id"], "batch_id": self.batch["id"], "qty_units": 5,
                 "rate_per_unit": 2.45, "gst_rate": 12},
                {"product_id": self.product["id"], "batch_id": self.batch["id"], "qty_units": 99999,
                 "rate_per_unit": 2.45, "gst_rate": 12}]})
        self.assertEqual(call("products.get", {"id": self.product["id"]})["stock_units"], before)
        self.assertEqual(len(call("sales.list", {})["rows"]), bills)
        self.assertEqual(call("accounts.balances")["cash"], cash)

    def test_expired_batches_cannot_be_billed(self):
        expired = call("batches.save", {"product_id": self.product["id"], "batch_no": "OLD1",
                                        "expiry": add_months(today(), -3)[:7], "mrp": 24.5,
                                        "rate_per_unit": 1.6, "qty_units": 50})
        with self.assertRaisesRegex(Exception, "has expired"):
            call("sales.create", {"payment_mode": "Cash", "items": [
                {"product_id": self.product["id"], "batch_id": expired["id"], "qty_units": 1,
                 "rate_per_unit": 2.45, "gst_rate": 12}]})
        picks = call("stock.allocate", {"product_id": self.product["id"], "qty_units": 999})["picks"]
        self.assertTrue(all(p["batch_no"] != "OLD1" for p in picks))

    def test_bill_discount_keeps_gst_consistent(self):
        sale = call("sales.create", {"payment_mode": "Cash", "bill_discount": 10, "items": [
            {"product_id": self.product["id"], "batch_id": self.batch["id"], "qty_units": 20,
             "rate_per_unit": 2.45, "gst_rate": 12}]})
        self.assertEqual(sale["subtotal"], 39.0)      # 49 less 10
        self.assertEqual(sale["gst_amount"], 4.68)    # 12% of 39
        self.assertEqual(r2(sum(i["taxable"] for i in sale["items"])), sale["subtotal"])

    def test_a_sales_return_restores_stock_and_refunds(self):
        sale = call("sales.create", {"payment_mode": "Cash", "items": [
            {"product_id": self.product["id"], "batch_id": self.batch["id"], "qty_units": 10,
             "rate_per_unit": 2.45, "gst_rate": 12}]})
        stock = call("products.get", {"id": self.product["id"]})["stock_units"]
        cash = call("accounts.balances")["cash"]
        lookup = call("returns.saleLookup", {"id": sale["id"]})
        self.assertEqual(lookup["items"][0]["returnable_units"], 10)
        credit = call("returns.createSale", {"sale_id": sale["id"], "refund_mode": "Cash", "items": [
            {"sale_item_id": lookup["items"][0]["id"], "qty_units": 4, "restock": 1}]})
        self.assertEqual(call("products.get", {"id": self.product["id"]})["stock_units"], stock + 4)
        self.assertEqual(call("accounts.balances")["cash"], r2(cash - credit["total"]))
        with self.assertRaisesRegex(Exception, "only 6 of"):
            call("returns.createSale", {"sale_id": sale["id"], "refund_mode": "Cash", "items": [
                {"sale_item_id": lookup["items"][0]["id"], "qty_units": 7}]})

    def test_loose_sale_of_a_pack_only_medicine_is_refused(self):
        sealed = call("products.save", {"name": "Sealed Syrup 60ml", "pack_size": 6, "allow_loose": 0,
                                        "gst_rate": 12, "pack_label": "Box", "unit_label": "Bottle"})
        batch = call("batches.save", {"product_id": sealed["id"], "batch_no": "SY1",
                                      "expiry": expiry_in(12), "mrp": 600, "rate_per_unit": 70,
                                      "qty_units": 12})
        with self.assertRaisesRegex(Exception, "multiples of 6"):
            call("sales.create", {"payment_mode": "Cash", "items": [
                {"product_id": sealed["id"], "batch_id": batch["id"], "qty_units": 4,
                 "rate_per_unit": 100, "gst_rate": 12}]})
        ok = call("sales.create", {"payment_mode": "Cash", "items": [
            {"product_id": sealed["id"], "batch_id": batch["id"], "qty_units": 6,
             "rate_per_unit": 100, "gst_rate": 12}]})
        self.assertEqual(ok["items"][0]["qty_units"], 6)

    def test_roles_are_enforced_in_the_server(self):
        call("auth.createUser", {"username": "cashier1", "name": "Counter Staff",
                                 "role": "cashier", "password": "pass123"})
        call("auth.login", {"username": "cashier1", "password": "pass123"})
        with self.assertRaisesRegex(Exception, "permission"):
            call("products.save", {"name": "Sneaky Product"})
        with self.assertRaisesRegex(Exception, "administrator"):
            call("auth.users")
        # …but a cashier can still bill.
        sale = call("sales.create", {"payment_mode": "Cash", "items": [
            {"product_id": self.product["id"], "batch_id": self.batch["id"], "qty_units": 1,
             "rate_per_unit": 2.45, "gst_rate": 12}]})
        self.assertTrue(sale["id"])
        call("auth.login", {"username": "admin", "password": "shop@2026"})

    def test_deleting_a_bill_returns_stock_and_clears_the_money(self):
        sale = call("sales.create", {"payment_mode": "Cash", "items": [
            {"product_id": self.product["id"], "batch_id": self.batch["id"], "qty_units": 3,
             "rate_per_unit": 2.45, "gst_rate": 12}]})
        stock = call("products.get", {"id": self.product["id"]})["stock_units"]
        cash = call("accounts.balances")["cash"]
        call("sales.remove", {"id": sale["id"], "reason": "entered twice"})
        self.assertEqual(call("products.get", {"id": self.product["id"]})["stock_units"], stock + 3)
        self.assertEqual(call("accounts.balances")["cash"], r2(cash - sale["total"]))
        self.assertIsNone(call("sales.get", {"id": sale["id"]}))

    def test_duplicate_supplier_bill_numbers_are_rejected(self):
        supplier = call("suppliers.save", {"name": "Repeat Distributors"})
        line = {"product_id": self.product["id"], "batch_no": "RD1", "expiry": expiry_in(12),
                "mrp": 10, "qty_units": 1, "rate_per_unit": 1, "gst_rate": 12}
        call("purchases.create", {"supplier_id": supplier["id"], "ref_no": "DUP-1", "items": [line]})
        with self.assertRaisesRegex(Exception, "already entered"):
            call("purchases.create", {"supplier_id": supplier["id"], "ref_no": "DUP-1", "items": [line]})

    def test_gst_reports_add_up_and_reconcile(self):
        bills = call("sales.list", {"from": today(), "to": today()})
        gstr1 = call("gst.gstr1", {"from": today(), "to": today()})
        self.assertEqual(gstr1["totals"]["taxable"],
                         r2(sum(row["subtotal"] for row in bills["rows"])))
        self.assertEqual(r2(gstr1["totals"]["cgst"] + gstr1["totals"]["sgst"]),
                         r2(bills["totals"]["gst"]))
        reconciliation = call("gst.reconcile", {"from": today(), "to": today()})
        self.assertTrue(reconciliation["clean"], reconciliation["mismatches"])

    def test_a_restore_refuses_to_run_without_confirmation(self):
        # A bill of our own, so this test does not depend on the others.
        sale = call("sales.create", {"payment_mode": "Cash", "items": [
            {"product_id": self.product["id"], "batch_id": self.batch["id"], "qty_units": 2,
             "rate_per_unit": 2.45, "gst_rate": 12}]})
        backup = call("backup.create", {})
        with self.assertRaisesRegex(Exception, "Please confirm"):
            call("backup.restore", {"sourcePath": backup["path"]})
        junk = Path(backup["path"]).parent / "not-a-backup.db"
        junk.write_text("this is not a database")
        with self.assertRaises(Exception):
            call("backup.restore", {"sourcePath": str(junk), "confirm": True})
        # The live database is untouched after a refused restore.
        self.assertIsNotNone(call("sales.get", {"id": sale["id"]}))

    def test_unknown_channels_fail_loudly(self):
        with self.assertRaisesRegex(Exception, "Unknown action"):
            call("does.not.exist")


if __name__ == "__main__":
    unittest.main()
