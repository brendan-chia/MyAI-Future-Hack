"""
Safelah — Malaysia Scammer Data Scraper
========================================
Scrapes scammer phone numbers and bank accounts from:
  1. kenascam.com  — WordPress blog with real Malaysian scam reports
                     (phone numbers + bank accounts + modus operandi)
  2. priceshop.com — Curated scam call number list (updated April 2025)

Output files:
  scam_phones.jsonl        → phone number records (entity_type: phone_number)
  scam_bank_accounts.jsonl → bank account records (entity_type: bank_account)

Install:
  pip install requests beautifulsoup4 pandas

Usage:
  python scrape_malaysia_scammers.py
  python scrape_malaysia_scammers.py --pages 20
  python scrape_malaysia_scammers.py --source kenascam
  python scrape_malaysia_scammers.py --source priceshop
"""

import re
import json
import time
import hashlib
import logging
import argparse
from datetime import date

import requests
from bs4 import BeautifulSoup

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

TODAY = str(date.today())

HEADERS = {
    "User-Agent": (
        "Safelah-ScamDetection/1.0 "
        "(public safety research tool; contact@safelah.my)"
    ),
    "Accept-Language": "ms-MY,ms;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml",
}

DELAY = 2.0  # seconds between requests — polite crawl


# ── Regex patterns (tuned for Malaysian formats) ───────────────────────────

# Phone: 011-XXXXXXXX, 0123456789, +60123456789, 60123456789
PHONE_RE = re.compile(
    r"\b(\+?60[-\s]?|0)"
    r"(1[0-9][-\s]?\d{3,4}[-\s]?\d{4}"   # 01x mobile
    r"|[3-9]\d[-\s]?\d{6,8})"             # 0x landline
)

# Bank account: sequences of 8-20 digits, often preceded by bank name
BANK_ACC_RE = re.compile(r"\b(\d{8,20})\b")

# Known Malaysian banks — used to tag which bank an account belongs to
BANKS = [
    "Maybank", "CIMB", "Public Bank", "RHB", "Hong Leong",
    "AmBank", "Bank Islam", "BSN", "Bank Rakyat", "Affin",
    "Alliance", "OCBC", "Standard Chartered", "HSBC", "UOB",
    "Touch n Go", "TnG", "TNG", "GrabPay", "Boost", "ShopeePay",
    "Duitnow", "DuitNow", "BigPay",
]
BANK_RE = re.compile(
    r"\b(" + "|".join(re.escape(b) for b in BANKS) + r")\b",
    re.IGNORECASE
)


# ── Helpers ────────────────────────────────────────────────────────────────

def clean_phone(raw: str) -> str | None:
    """Normalise to 60XXXXXXXXX format."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("60"):
        digits = digits[2:]
    digits = digits.lstrip("0")
    if len(digits) < 7 or len(digits) > 11:
        return None
    return "60" + digits


def extract_bank_name(text: str, position: int, window: int = 80) -> str:
    """Look backwards/forwards from account number for a bank name."""
    snippet = text[max(0, position - window): position + window]
    match = BANK_RE.search(snippet)
    return match.group(1).title() if match else "Unknown"


def make_phone_record(phone: str, scam_type: str, notes: str) -> dict:
    return {
        "entity_value":  phone,
        "entity_type":   "phone_number",
        "scam_type":     scam_type,
        "flagged_date":  TODAY,
        "risk_level":    "high",
        "notes":         notes[:200] if notes else "",
        "bank_name":     "",
    }


def make_bank_record(account: str, bank: str, scam_type: str,
                     notes: str) -> dict:
    return {
        "entity_value":  account,
        "entity_type":   "bank_account",
        "scam_type":     scam_type,
        "flagged_date":  TODAY,
        "risk_level":    "high",
        "notes":         notes[:200] if notes else "",
        "bank_name":     bank,
    }


def get_soup(url: str, session: requests.Session) -> BeautifulSoup | None:
    try:
        resp = session.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    except requests.RequestException as e:
        log.warning(f"  Failed to fetch {url}: {e}")
        return None


# ── SOURCE 1: kenascam.com ─────────────────────────────────────────────────
#
# Structure (confirmed from live inspection):
#   WordPress blog — each post is an <article> element
#   Post body is in <div class="entry-content">
#   Date is in <time class="entry-date">
#   Categories are in <span class="cat-links">
#   Pagination: /page/2/, /page/3/, etc.
#
# Each post body contains raw text like:
#   "Phone no : 01161233494"
#   "Acc no 1 : BSN 1299541100577643 NUR SAKINAH..."
#   "Maybank 311140748974 Avin Sim Wei"
# ──────────────────────────────────────────────────────────────────────────

def scrape_kenascam_post(article: BeautifulSoup, post_url: str) -> tuple[list, list]:
    """Extract phones + bank accounts from a single kenascam.com post."""
    phone_records = []
    bank_records  = []

    # Get post metadata
    date_tag  = article.select_one("time.entry-date, time.published")
    cat_tag   = article.select_one(".cat-links, .entry-categories")
    body_tag  = article.select_one(".entry-content, .entry-summary")

    post_date  = date_tag.get("datetime", TODAY)[:10] if date_tag else TODAY
    scam_type  = cat_tag.get_text(strip=True)         if cat_tag else "unknown"
    body_text  = body_tag.get_text(separator=" ")      if body_tag else ""
    title_tag  = article.select_one("h1.entry-title, h2.entry-title")
    notes      = title_tag.get_text(strip=True)        if title_tag else ""

    # ── Extract phone numbers ──────────────────────────────────────────────
    for match in PHONE_RE.finditer(body_text):
        raw   = match.group()
        phone = clean_phone(raw)
        if phone:
            phone_records.append(make_phone_record(
                phone     = phone,
                scam_type = scam_type,
                notes     = notes,
            ))

    # ── Extract bank account numbers ───────────────────────────────────────
    for match in BANK_ACC_RE.finditer(body_text):
        account = match.group(1)
        # Skip numbers that look like phone numbers (already captured above)
        if PHONE_RE.match("0" + account[2:]) or len(account) < 8:
            continue
        bank = extract_bank_name(body_text, match.start())
        bank_records.append(make_bank_record(
            account   = account,
            bank      = bank,
            scam_type = scam_type,
            notes     = notes,
        ))

    return phone_records, bank_records


def scrape_kenascam(max_pages: int) -> tuple[list, list]:
    """Paginate through kenascam.com and scrape all posts."""
    session       = requests.Session()
    all_phones    = []
    all_accounts  = []

    log.info("=" * 60)
    log.info("SOURCE 1: kenascam.com")
    log.info("=" * 60)

    for page in range(1, max_pages + 1):
        url = "https://kenascam.com/" if page == 1 else f"https://kenascam.com/page/{page}/"
        log.info(f"Page {page}/{max_pages} → {url}")

        soup = get_soup(url, session)
        if not soup:
            log.warning(f"  Skipping page {page}")
            time.sleep(DELAY)
            continue

        # WordPress standard: each post is an <article> tag
        articles = soup.select("article")
        if not articles:
            log.info(f"  No articles found on page {page} — end of content")
            break

        log.info(f"  Found {len(articles)} posts")

        for article in articles:
            # Get link to full post (for logging)
            link_tag = article.select_one("a[href]")
            post_url = link_tag["href"] if link_tag else url

            phones, accounts = scrape_kenascam_post(article, post_url)
            all_phones.extend(phones)
            all_accounts.extend(accounts)

        log.info(f"  Running totals — phones: {len(all_phones)}, accounts: {len(all_accounts)}")
        time.sleep(DELAY)

    log.info(f"\nkenascam.com done — {len(all_phones)} phones, {len(all_accounts)} bank accounts\n")
    return all_phones, all_accounts


# ── SOURCE 2: priceshop.com ────────────────────────────────────────────────
#
# Structure (confirmed from live inspection):
#   Single article page — phone numbers listed in body paragraphs
#   No table — numbers embedded in text
#   Last updated: April 2025
# ──────────────────────────────────────────────────────────────────────────

def scrape_priceshop() -> list:
    """Scrape scam call numbers from PriceShop Malaysia article."""
    url     = "https://my.priceshop.com/en/news/scam-call-numbers-malaysia/"
    session = requests.Session()

    log.info("=" * 60)
    log.info("SOURCE 2: priceshop.com")
    log.info("=" * 60)
    log.info(f"Fetching → {url}")

    soup = get_soup(url, session)
    if not soup:
        log.error("  Could not fetch PriceShop page")
        return []

    # Get full article body text
    body = soup.select_one("article, .entry-content, .post-content, main")
    if not body:
        body = soup  # fallback to full page

    body_text = body.get_text(separator=" ")
    records   = []

    for match in PHONE_RE.finditer(body_text):
        raw   = match.group()
        phone = clean_phone(raw)
        if phone:
            records.append(make_phone_record(
                phone     = phone,
                scam_type = "scam_call",
                notes     = "PriceShop Malaysia scam call database — updated April 2025",
            ))

    log.info(f"  Extracted {len(records)} phone numbers")
    return records


# ── Filtering + Deduplication + Save ───────────────────────────────────────

def _filter_records(records: list, label: str) -> list:
    """Drop rows with scam_type 'CategoriesUncategorized' or bank_name 'Unknown'."""
    filtered = []
    dropped_uncategorized = 0
    dropped_unknown_bank = 0
    for r in records:
        if r.get("scam_type") == "CategoriesUncategorized":
            dropped_uncategorized += 1
            continue
        if r.get("bank_name") == "Unknown":
            dropped_unknown_bank += 1
            continue
        filtered.append(r)
    log.info(f"  Filter {label}: {len(records)} → {len(filtered)} "
             f"(dropped {dropped_uncategorized} uncategorized, "
             f"{dropped_unknown_bank} unknown bank)")
    return filtered


def _write_jsonl(records: list, filepath: str, label: str,
                 exclude_keys: list[str] | None = None) -> None:
    """Deduplicate by entity_value, wrap in Discovery Engine document format, and write as JSONL.

    Each output line follows the Discovery Engine import schema:
        {"id": "<unique_id>", "structData": { ... }}
    """
    seen = set()
    unique = []
    for r in records:
        if r["entity_value"] not in seen:
            seen.add(r["entity_value"])
            # Strip excluded keys if specified
            if exclude_keys:
                r = {k: v for k, v in r.items() if k not in exclude_keys}
            unique.append(r)
    dupes = len(records) - len(unique)
    # Determine ID prefix from entity type
    id_prefix = "phone_" if unique and unique[0].get("entity_type") == "phone_number" else "bank_"
    with open(filepath, "w", encoding="utf-8") as f:
        for r in unique:
            doc_id = id_prefix + hashlib.md5(r["entity_value"].encode()).hexdigest()[:12]
            doc = {"id": doc_id, "structData": r}
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")
    log.info(f"✅ {filepath}  — {len(unique)} unique {label} ({dupes} duplicates removed)")


def dedup_and_save(phones: list, accounts: list) -> None:
    """Filter, deduplicate, and save phones → scam_phones.jsonl, accounts → scam_bank_accounts.jsonl."""

    log.info("\n── Filtering ────────────────────────────────────────────")
    # ── Filter out unwanted rows ──────────────────────────────────────────
    phones   = _filter_records(phones, "phones")
    accounts = _filter_records(accounts, "bank accounts")

    if not phones and not accounts:
        log.warning("No records collected — nothing to save")
        return

    if phones:
        _write_jsonl(phones, "scam_phones.jsonl", "phone numbers",
                     exclude_keys=["bank_name"])
    else:
        log.warning("No phone numbers collected")

    if accounts:
        _write_jsonl(accounts, "scam_bank_accounts.jsonl", "bank accounts")
    else:
        log.warning("No bank accounts collected")

    # ── Preview ────────────────────────────────────────────────────────────
    if phones:
        log.info("\n── Phone sample (first 5) ───────────────────────────")
        for r in phones[:5]:
            log.info(f"  {r['entity_value']}  [{r['scam_type']}]  {r['notes'][:60]}")

    if accounts:
        log.info("\n── Bank account sample (first 5) ────────────────────")
        for r in accounts[:5]:
            log.info(f"  {r['entity_value']}  {r['bank_name']}  [{r['scam_type']}]")


# ── Next steps ─────────────────────────────────────────────────────────────

def print_next_steps() -> None:
    log.info("""
── Next steps ──────────────────────────────────────────────────────
1. Upload to Cloud Storage:
   gsutil cp scam_phones.jsonl        gs://safelah-datastore/entities/
   gsutil cp scam_bank_accounts.jsonl gs://safelah-datastore/entities/

2. Import into BigQuery (JSONL / newline-delimited JSON):
   bq load --source_format=NEWLINE_DELIMITED_JSON --autodetect \\
     safelah.scam_phones scam_phones.jsonl
   bq load --source_format=NEWLINE_DELIMITED_JSON --autodetect \\
     safelah.scam_bank_accounts scam_bank_accounts.jsonl

3. Or use BigQuery console:
   BigQuery → safelah dataset → Create Table → Upload
   Select format: JSONL (newline-delimited JSON)
────────────────────────────────────────────────────────────────────
""")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Scrape Malaysian scammer data for Safelah BigQuery data store"
    )
    parser.add_argument(
        "--pages", type=int, default=200,
        help="Max pages to scrape from kenascam.com (default: 100)"
    )
    parser.add_argument(
        "--source", choices=["all", "kenascam", "priceshop"], default="all",
        help="Which source to scrape (default: all)"
    )
    args = parser.parse_args()

    log.info("Safelah Scammer Data Scraper")
    log.info(f"Source: {args.source} | Max pages: {args.pages}")
    log.info("─" * 60)

    all_phones   = []
    all_accounts = []

    if args.source in ("all", "kenascam"):
        phones, accounts = scrape_kenascam(args.pages)
        all_phones.extend(phones)
        all_accounts.extend(accounts)

    if args.source in ("all", "priceshop"):
        phones = scrape_priceshop()
        all_phones.extend(phones)

    log.info("\n── Final totals ─────────────────────────────────────────")
    log.info(f"   Phone numbers:   {len(all_phones)}")
    log.info(f"   Bank accounts:   {len(all_accounts)}")
    log.info("─" * 60)

    dedup_and_save(all_phones, all_accounts)
    print_next_steps()


if __name__ == "__main__":
    main()