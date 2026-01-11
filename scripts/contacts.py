"""
Contact loading and lookup from macOS AddressBook databases.
"""

import os
import re
import sqlite3
from glob import glob


def normalize_phone(phone):
    """Normalize phone number for matching.

    Preserves country code to avoid international number collisions.
    For numbers with 11+ digits starting with country code, keeps the full number.
    For 10-digit numbers (US/Canada without country code), keeps as-is.
    """
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        # US/Canada with country code - normalize to 10 digits
        return digits[1:]
    if len(digits) == 10:
        # US/Canada without country code
        return digits
    # International or other formats - keep full digits to avoid collisions
    return digits


def load_contacts(contacts_dir):
    """Load contact name and ID mappings from AddressBook databases.

    Returns mappings from phone/email to (name, contact_id) tuples.
    The contact_id is used to correctly group identifiers belonging to the
    same contact, avoiding incorrect merges when different people share names.
    """
    phone_to_contact = {}  # normalized_phone -> (name, contact_id)
    email_to_contact = {}  # email -> (name, contact_id)

    db_files = glob(os.path.join(contacts_dir, "*/AddressBook-v22.abcddb"))
    if not db_files:
        print(f"Warning: No AddressBook databases found in {contacts_dir}")
        return phone_to_contact, email_to_contact

    for db_path in db_files:
        try:
            uri = f"file:{db_path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True)
            cursor = conn.cursor()

            # Phone numbers - include Z_PK as unique contact identifier
            cursor.execute("""
                SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, p.ZFULLNUMBER
                FROM ZABCDRECORD r
                JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
                WHERE p.ZFULLNUMBER IS NOT NULL
            """)
            for contact_id, first, last, org, nick, phone in cursor.fetchall():
                name = " ".join(p for p in [first, last] if p) or nick or org
                if name:
                    normalized = normalize_phone(phone)
                    if normalized and normalized not in phone_to_contact:
                        phone_to_contact[normalized] = (name, f"{db_path}:{contact_id}")

            # Emails - include Z_PK as unique contact identifier
            cursor.execute("""
                SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, e.ZADDRESS
                FROM ZABCDRECORD r
                JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
                WHERE e.ZADDRESS IS NOT NULL
            """)
            for contact_id, first, last, org, nick, email in cursor.fetchall():
                name = " ".join(p for p in [first, last] if p) or nick or org
                if name and email.lower() not in email_to_contact:
                    email_to_contact[email.lower()] = (name, f"{db_path}:{contact_id}")

            conn.close()
        except Exception as e:
            print(f"Warning: Could not read {db_path}: {e}")

    return phone_to_contact, email_to_contact


def lookup_contact(identifier, phone_to_contact, email_to_contact):
    """Look up contact info (name, contact_id) from phone or email.

    Returns (name, contact_id) tuple or (None, None) if not found.
    """
    if not identifier:
        return None, None
    if "@" in identifier:
        return email_to_contact.get(identifier.lower(), (None, None))
    return phone_to_contact.get(normalize_phone(identifier), (None, None))
