# Proposal Generator AWS Migration Starter

This project now has a Flask starter backend so the browser no longer has to talk directly to Firebase.

## What changed

- `backend/` contains a Flask API for admin setup/login, catalog, plans, and proposals.
- `wsgi.py` exposes the Flask app for Gunicorn.
- The frontend can now load and save data through `/api/...` endpoints.
- Local development defaults to a JSON file in `data/proposal_generator.json`.
- DynamoDB support is stubbed in behind a repository layer so you can switch with environment variables.

## Local development

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
flask --app wsgi run --debug
```

The static frontend is served by Flask at `/`, and API requests are served from `/api`.

## Deploy shape for EC2

- Nginx terminates HTTPS and proxies to Gunicorn.
- Gunicorn runs `wsgi:app`.
- Flask serves the SPA/static assets and the JSON API.
- DynamoDB becomes the system of record for catalog, plans, proposals, and admin auth metadata.

Example Gunicorn command:

```bash
gunicorn --bind 127.0.0.1:8000 wsgi:app
```

## Suggested next migration steps

1. Move proposal save/load to a dedicated proposal table design in DynamoDB instead of the single-item starter layout used here.
2. Replace sessionStorage-only admin state with a real Flask session or signed token.
3. Move PDF generation server-side if you want consistent branded output and archival on AWS.
4. Add boto3 IAM-backed credentials on EC2 and set `DATA_BACKEND=dynamodb`.

## Minimal DynamoDB starter schema

This starter expects a table with a partition key named `pk` (string). It stores four items:

- `catalog`
- `plans`
- `proposals`
- `admin_auth`

That is enough to start, but I would treat it as a migration bridge rather than your final production schema.
