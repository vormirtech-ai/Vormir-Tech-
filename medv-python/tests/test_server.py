"""The local HTTP layer: static files, the /api channel and the local-only guard."""
import base64
import json
import shutil
import threading
import unittest
import urllib.error
import urllib.request

from tests.helpers import fresh_database

from medv import db, server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = fresh_database()
        cls.port = server.find_port(8911)
        cls.httpd = server.serve(cls.port)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        db.close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def url(self, path=""):
        return f"http://127.0.0.1:{self.port}{path}"

    def post(self, path, body=None, headers=None):
        request = urllib.request.Request(
            self.url(path), data=json.dumps(body or {}).encode(),
            headers={"content-type": "application/json", **(headers or {})})
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read())

    def test_serves_the_interface(self):
        with urllib.request.urlopen(self.url("/")) as response:
            page = response.read().decode()
        self.assertIn("MedV", page)
        self.assertIn("js/bridge.js", page)
        with urllib.request.urlopen(self.url("/js/app.js")) as response:
            self.assertIn("javascript", response.headers["Content-Type"])

    def test_unknown_paths_fall_back_to_the_app(self):
        with urllib.request.urlopen(self.url("/no/such/page")) as response:
            self.assertIn("MedV", response.read().decode())

    def test_api_channel_round_trip(self):
        result = self.post("/api", {"channel": "app.info"})
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["productName"], "MedV")
        self.assertEqual(result["data"]["edition"], "python")

    def test_expected_errors_come_back_as_json_not_a_stack_trace(self):
        result = self.post("/api", {"channel": "auth.login",
                                    "payload": {"username": "admin", "password": "nope"}})
        self.assertFalse(result["ok"])
        self.assertTrue(result["error"]["expected"])
        self.assertEqual(result["error"]["message"], "Incorrect username or password.")

    def test_unknown_channels_are_reported(self):
        result = self.post("/api", {"channel": "nope.nope"})
        self.assertFalse(result["ok"])
        self.assertIn("Unknown action", result["error"]["message"])

    def test_state_endpoint_describes_this_computer(self):
        state = self.post("/api/state")
        self.assertEqual(state["edition"], "python")
        self.assertIn("medbill.db", state["paths"]["db"])

    def test_a_page_from_another_origin_is_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post("/api", {"channel": "app.info"}, headers={"Origin": "http://evil.example"})
        self.assertEqual(caught.exception.code, 403)

    def test_upload_returns_a_path_the_backup_service_can_read(self):
        result = self.post("/api/upload", {"name": "x.db", "base64": base64.b64encode(b"hello").decode()})
        self.assertTrue(result["ok"])
        self.assertEqual(result["size"], 5)

    def test_backup_target_is_a_folder_the_user_can_find(self):
        result = self.post("/api/backup-target", {"name": "MedBillPro_Backup_test.db"})
        self.assertTrue(result["path"].endswith("MedBillPro_Backup_test.db"))
        self.assertIn("MedV Backups", result["folder"])


if __name__ == "__main__":
    unittest.main()
