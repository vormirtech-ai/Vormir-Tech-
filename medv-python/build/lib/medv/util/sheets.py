"""
Reading a distributor's bill.

Only two formats ever turn up: .xlsx (a ZIP of XML) and .csv/.tsv. Both are
handled with the standard library — nothing to install.
"""

from __future__ import annotations
import csv
import io
import re
import zipfile
from datetime import date, timedelta

_SI = re.compile(r"<si\b[^>]*>(.*?)</si>", re.S)
_ROW = re.compile(r"<row\b[^>]*\br=\"(\d+)\"[^>]*>(.*?)</row>", re.S)
_CELL = re.compile(r"<c\b([^>]*)/>|<c\b([^>]*)>(.*?)</c>", re.S)
_VALUE = re.compile(r"<v>(.*?)</v>", re.S)
_TAG = re.compile(r"<[^>]+>")


def _decode_xml_text(fragment: str) -> str:
    text = _TAG.sub("", fragment)
    for entity, char in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'")):
        text = text.replace(entity, char)
    text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
    return text.replace("&amp;", "&")


def _column_index(ref: str) -> int:
    letters = re.sub(r"\d+", "", ref)
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - 64)
    return index - 1


def serial_to_iso(serial) -> str | None:
    """Excel stores dates as a day count from 1899-12-30."""
    try:
        number = float(serial)
    except (TypeError, ValueError):
        return None
    if not 1 <= number <= 90000:
        return None
    return (date(1899, 12, 30) + timedelta(days=int(number))).isoformat()


def read_workbook(data: bytes) -> list[list[str]]:
    """First worksheet of an .xlsx, as rows of strings."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("That file is not a valid .xlsx workbook.")

    names = archive.namelist()
    shared: list[str] = []
    if "xl/sharedStrings.xml" in names:
        xml = archive.read("xl/sharedStrings.xml").decode("utf-8", "replace")
        shared = [_decode_xml_text(m.group(1)) for m in _SI.finditer(xml)]

    sheets = sorted(n for n in names if re.match(r"^xl/worksheets/sheet\d+\.xml$", n))
    if not sheets:
        raise ValueError("No worksheet was found inside that workbook.")
    xml = archive.read(sheets[0]).decode("utf-8", "replace")

    rows: list[list[str]] = []
    for row_match in _ROW.finditer(xml):
        cells: dict[int, str] = {}
        for cell in _CELL.finditer(row_match.group(2)):
            attrs = cell.group(1) or cell.group(2) or ""
            body = cell.group(3) or ""
            ref = re.search(r'r="([A-Z]+\d+)"', attrs)
            kind = re.search(r't="([^"]+)"', attrs)
            index = _column_index(ref.group(1)) if ref else len(cells)
            cell_type = kind.group(1) if kind else "n"
            if cell_type == "s":
                value_match = _VALUE.search(body)
                position = int(value_match.group(1)) if value_match else -1
                value = shared[position] if 0 <= position < len(shared) else ""
            elif cell_type == "inlineStr":
                value = _decode_xml_text(body)
            else:
                value_match = _VALUE.search(body)
                value = _decode_xml_text(value_match.group(1)) if value_match else ""
            cells[index] = str(value).strip()
        if cells:
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
    return rows


def read_delimited(text: str) -> list[list[str]]:
    """CSV, semicolon-separated or tab-separated — whichever it turns out to be."""
    clean = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    head = clean.split("\n", 1)[0] if clean else ""
    delimiter = max((",", ";", "\t"), key=head.count)
    if head.count(delimiter) == 0:
        delimiter = ","
    rows = []
    for row in csv.reader(io.StringIO(clean), delimiter=delimiter):
        cleaned = [cell.strip() for cell in row]
        if any(cell for cell in cleaned):
            rows.append(cleaned)
    return rows


def read_any(data: bytes, filename: str = "") -> list[list[str]]:
    is_xlsx = filename.lower().endswith(".xlsx") or data[:2] == b"PK"
    if is_xlsx:
        return read_workbook(data)
    return read_delimited(data.decode("utf-8", "replace"))
