"""Convert the 1C stock report workbook to the PEAK snapshot format."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re

from openpyxl import load_workbook


LOCATIONS = {
    "склад лиственная": ("listvennaya", "Склад «Лиственная»"),
    "магазин кадырова": ("kadyrova", "Магазин Кадырова"),
    "нальчик": ("nalchik", "Нальчик"),
    "тц весна": ("vesna", "ТЦ «Весна»"),
    "тц этажи": ("etazhi", "ТЦ «Этажи»"),
}


def text(value):
    return "" if value is None else str(value).strip()


def quantity(value, line):
    if value is None or value == "":
        return 0
    if type(value) not in (float, int) or int(value) != value or abs(value) > 999_999:
        raise ValueError(f"Строка {line}: некорректный остаток {value!r}")
    return int(value)


def convert(path):
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = workbook.active
        return convert_rows(enumerate(sheet.values, 1))
    finally:
        workbook.close()


def convert_rows(rows):
    for line, row in rows:
        labels = [text(v).lower() for v in row]
        if "артикул" in labels and "номенклатура" in labels and "ед. изм." in labels:
            break
    else:
        raise ValueError("Не найдены колонки отчёта «Остатки и доступность товаров»")
    article_col, model_col, unit_col = (labels.index(k) for k in ("артикул", "номенклатура", "ед. изм."))
    _line, measures = next(rows)
    found = {}
    for index, label in enumerate(labels):
        if label in LOCATIONS and text(measures[index]).lower() == "в наличии":
            if label in found:
                raise ValueError(f"Повтор колонки «В наличии»: {label}")
            found[label] = index
    if found.keys() != LOCATIONS.keys():
        raise ValueError("В отчёте ожидаются колонки «В наличии» для пяти складов")
    stock_columns = list(found.values())
    variants = {}
    unavailable = []
    current = None
    report_totals = [0] * len(found)
    excluded = [0] * len(found)

    def add_variant(model, characteristic, amounts, line_number):
        article, name, *_ = model
        color, separator, size = characteristic.partition("|")
        if separator and "|" in size:
            raise ValueError(f"Строка {line_number}: проверьте характеристику {characteristic!r}")
        color, size = color.strip(), size.strip()
        key = article.upper(), color.lower(), size.upper()
        saved = variants.setdefault(key, (article, color, size, name[:250], [0] * len(found)))
        for i, amount in enumerate(amounts):
            saved[-1][i] += amount

    def finish(model, variants_for_model):
        if model is None:
            return
        article, name, amounts, line_number = model
        for i, amount in enumerate(amounts):
            report_totals[i] += amount
        if not article:
            unavailable.append({"row": line_number, "name": name, "amounts": amounts})
            for i, amount in enumerate(amounts):
                excluded[i] += amount
            return
        if not variants_for_model:
            add_variant(model, "", amounts, line_number)
            return
        for i, amount in enumerate(amounts):
            if sum(values[i] for _, values, _ in variants_for_model) != amount:
                raise ValueError(f"Строка {line_number}: сумма по размерам расходится с итогом товара")
        for characteristic, values, variant_line in variants_for_model:
            add_variant(model, characteristic, values, variant_line)

    variant_rows = []
    for line, row in rows:
        article_cell, product = text(row[article_col]), text(row[model_col])
        if article_cell.lower() == "итого" and not product:
            break
        amounts = [quantity(row[col], line) for col in stock_columns]
        if product and row[unit_col]:
            finish(current, variant_rows)
            codes = re.findall(r"\(([a-zA-Z0-9][a-zA-Z0-9._/-]*\d[a-zA-Z0-9._/-]*)\)", product)
            article = article_cell or (codes[-1] if codes else "")
            current = (article, product, amounts, line)
            variant_rows = []
        elif article_cell and not product and current:
            variant_rows.append((article_cell, amounts, line))
        elif any(amounts):
            raise ValueError(f"Строка {line}: остаток без артикула или характеристики")
    finish(current, variant_rows)
    if not variants:
        raise ValueError("Отчёт не содержит ни одной товарной строки")

    locations = []
    for i, label in enumerate(found):
        code, name = LOCATIONS[label]
        location_rows = []
        named = set()
        for article, color, size, product_name, counts in variants.values():
            if not counts[i] and (code != "listvennaya" or any(counts)):
                continue
            result = [article, color, size, counts[i]]
            if article.upper() not in named:
                result.append(product_name)
                named.add(article.upper())
            location_rows.append(result)
        if sum(row[3] for row in location_rows) != report_totals[i] - excluded[i]:
            raise ValueError(f"Сумма по складу {name} не совпадает с отчётом за вычетом строк без артикула")
        locations.append({"id": code, "name": name, "rows": location_rows})
    return locations, {"models": len({key[0] for key in variants}), "variants": len(variants), "excluded": unavailable,
                       "report_totals": dict(zip((LOCATIONS[k][0] for k in found), report_totals))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--updated-at", help="Время формирования отчёта в ISO 8601 с часовым поясом. Без него это пример.")
    args = parser.parse_args()
    locations, audit = convert(args.workbook)
    timestamp = None
    if args.updated_at:
        date = datetime.fromisoformat(args.updated_at)
        if date.utcoffset() is None:
            parser.error("в --updated-at требуется часовой пояс")
        timestamp = date.isoformat()
    args.output.write_text(json.dumps({"updatedAt": timestamp, "locations": locations}, ensure_ascii=False,
                                      separators=(",", ":")), encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False))


if __name__ == "__main__":
    main()
