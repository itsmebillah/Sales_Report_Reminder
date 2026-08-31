# Security Policy

## Supported status

This repository contains an operational automation system that handles sales, attendance, contact, and notification data. Deploy it only in an access-controlled Google Workspace and use synthetic data for development.

## Credentials

- Store Apps Script credentials in Script Properties or the access-controlled Dashboard configuration area.
- Store notification-sender infrastructure values in `notification-sender/.env` using `.env.example` as the contract.
- Never commit Meta access tokens, Telegram tokens, service-account JSON, session data, recipient phone numbers, or spreadsheet exports.
- Treat Google Sheets sharing rules and Apps Script deployment access as part of the security boundary.

## Operational safeguards

Keep test mode enabled until recipient routing is verified. Review queue records before enabling production delivery, restrict spreadsheet editors, and avoid publishing screenshots containing employee, customer, sales, or phone data.

Report security concerns privately to [itsmbillah@gmail.com](mailto:itsmbillah@gmail.com). Do not include credentials or personal data in a public issue.
