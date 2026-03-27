from flask import Flask, jsonify, request, send_from_directory
import copy
import hashlib
import json
import os
import secrets
import time
from pathlib import Path

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:
    boto3 = None
    BotoCoreError = ClientError = Exception


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_FILE = BASE_DIR / 'data' / 'proposal_generator.json'
DEFAULT_CATALOG = [
    {'id': 1, 'sku': 'GO9-LTE', 'desc': 'GO9 LTE/4G Model GPS Device', 'category': 'GPS Device', 'price': 149.00, 'price3yr': 149.00, 'active': True},
    {'id': 2, 'sku': 'GF-PLUS-CAM', 'desc': 'Geotab GO Focus Plus AI-Dash Camera', 'category': 'Dash Camera', 'price': 399.00, 'price3yr': 399.00, 'active': True},
    {'id': 3, 'sku': 'DEV-HARNESS', 'desc': 'GO Device Harness / Installation Adapter', 'category': 'Accessory', 'price': 50.00, 'price3yr': 50.00, 'active': True},
    {'id': 4, 'sku': 'DISC-3YR', 'desc': 'Equipment Discount on 3-Year Service Contract', 'category': 'Discount', 'price': -50.00, 'price3yr': -50.00, 'active': True},
    {'id': 5, 'sku': 'INSTALL-STD', 'desc': 'Standard Vehicle Installation (Per Unit)', 'category': 'Installation', 'price': 75.00, 'price3yr': 75.00, 'active': True},
    {'id': 6, 'sku': 'GO9-PLUS', 'desc': 'GO9 Plus 4G Device with Advanced Features', 'category': 'GPS Device', 'price': 199.00, 'price3yr': 179.00, 'active': True},
]
DEFAULT_PLANS = [
    {'id': 1, 'name': 'Geotab GO Plan', 'desc': 'Full telematics - live tracking, engine data, reports', 'rate': 29.99},
    {'id': 2, 'name': 'Geotab GO Focus Plus Video Plan', 'desc': 'AI dash cam plan with video streaming and events', 'rate': 29.99},
    {'id': 3, 'name': 'Geotab GO ProPlus Plan', 'desc': 'Enhanced features plus hours of service and integrations', 'rate': 39.99},
    {'id': 4, 'name': 'Asset Tracking Plan', 'desc': 'Non-powered asset tracking for trailers and equipment', 'rate': 9.99},
]


class RepositoryError(Exception):
    pass


class LocalRepository:
    def __init__(self, data_file):
        self.data_file = Path(data_file)
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        if not self.data_file.exists():
            self._write(self._default_payload())

    def _default_payload(self):
        return {
            'catalog': copy.deepcopy(DEFAULT_CATALOG),
            'plans': copy.deepcopy(DEFAULT_PLANS),
            'proposals': [],
            'admin_auth': None,
        }

    def _read(self):
        if not self.data_file.exists():
            return self._default_payload()
        with self.data_file.open('r', encoding='utf-8') as handle:
            return json.load(handle)

    def _write(self, payload):
        with self.data_file.open('w', encoding='utf-8') as handle:
            json.dump(payload, handle, indent=2)

    def get_catalog(self):
        return self._read()['catalog']

    def save_catalog(self, items):
        payload = self._read()
        payload['catalog'] = items
        self._write(payload)
        return items

    def get_plans(self):
        return self._read()['plans']

    def save_plans(self, items):
        payload = self._read()
        payload['plans'] = items
        self._write(payload)
        return items

    def get_proposals(self):
        return self._read()['proposals']

    def save_proposals(self, items):
        payload = self._read()
        payload['proposals'] = items
        self._write(payload)
        return items

    def get_admin_auth(self):
        return self._read()['admin_auth']

    def save_admin_auth(self, admin_auth):
        payload = self._read()
        payload['admin_auth'] = admin_auth
        self._write(payload)
        return admin_auth


class DynamoRepository:
    def __init__(self, table_name, region_name):
        if boto3 is None:
            raise RepositoryError('boto3 is required when DATA_BACKEND=dynamodb')
        resource = boto3.resource('dynamodb', region_name=region_name)
        self.table = resource.Table(table_name)

    def _get_item(self, key):
        try:
            response = self.table.get_item(Key={'pk': key})
            return response.get('Item')
        except (BotoCoreError, ClientError) as exc:
            raise RepositoryError(str(exc)) from exc

    def _put_item(self, key, value):
        try:
            self.table.put_item(Item={'pk': key, 'value': value})
            return value
        except (BotoCoreError, ClientError) as exc:
            raise RepositoryError(str(exc)) from exc

    def get_catalog(self):
        item = self._get_item('catalog')
        return item['value'] if item else copy.deepcopy(DEFAULT_CATALOG)

    def save_catalog(self, items):
        return self._put_item('catalog', items)

    def get_plans(self):
        item = self._get_item('plans')
        return item['value'] if item else copy.deepcopy(DEFAULT_PLANS)

    def save_plans(self, items):
        return self._put_item('plans', items)

    def get_proposals(self):
        item = self._get_item('proposals')
        return item['value'] if item else []

    def save_proposals(self, items):
        return self._put_item('proposals', items)

    def get_admin_auth(self):
        item = self._get_item('admin_auth')
        return item['value'] if item else None

    def save_admin_auth(self, admin_auth):
        return self._put_item('admin_auth', admin_auth)


_repository = None


def get_config():
    return {
        'SECRET_KEY': os.getenv('SECRET_KEY', 'dev-secret-change-me'),
        'DATA_BACKEND': os.getenv('DATA_BACKEND', 'local').lower(),
        'DATA_FILE': os.getenv('DATA_FILE', str(DEFAULT_DATA_FILE)),
        'DYNAMODB_TABLE': os.getenv('DYNAMODB_TABLE', 'proposal-generator'),
        'AWS_REGION': os.getenv('AWS_REGION', 'us-east-1'),
    }


def build_repository(config):
    if config['DATA_BACKEND'] == 'dynamodb':
        return DynamoRepository(config['DYNAMODB_TABLE'], config['AWS_REGION'])
    return LocalRepository(config['DATA_FILE'])


def repo():
    global _repository
    if _repository is None:
        _repository = build_repository(get_config())
    return _repository


def generate_salt():
    return secrets.token_hex(16)


def hash_admin_key(key, salt):
    return hashlib.sha256(f'{salt}{key}'.encode('utf-8')).hexdigest()


def json_error(message, status=400):
    return jsonify({'ok': False, 'error': message}), status


def get_record_signature(item):
    return '|'.join([
        str(item.get('company', '')),
        str(item.get('contact', '')),
        str(item.get('email', '')),
        str(item.get('address', '')),
        str(item.get('city', '')),
        str(item.get('state', '')),
        str(item.get('zip', '')),
        str(item.get('phone', '')),
        str(item.get('paymentTerms', '')),
        str(item.get('contractTerm', '')),
        str(item.get('orderType', '')),
        str(item.get('total', '')),
        str(item.get('monthly', '')),
        json.dumps(item.get('equipment', []), sort_keys=True),
        json.dumps(item.get('plans', []), sort_keys=True),
    ])


def normalize_proposals(items):
    merged = []
    by_signature = {}
    for item in items:
        signature = item.get('signature') or get_record_signature(item)
        item['signature'] = signature
        if signature not in by_signature:
            record = copy.deepcopy(item)
            record['hasProposal'] = bool(record.get('hasProposal') or record.get('docType') == 'Proposal')
            record['hasAgreement'] = bool(record.get('hasAgreement') or record.get('docType') == 'Agreement')
            by_signature[signature] = record
            merged.append(record)
            continue
        existing = by_signature[signature]
        existing['hasProposal'] = existing['hasProposal'] or item.get('hasProposal') or item.get('docType') == 'Proposal'
        existing['hasAgreement'] = existing['hasAgreement'] or item.get('hasAgreement') or item.get('docType') == 'Agreement'
        if item.get('timestamp', 0) > existing.get('timestamp', 0):
            existing['timestamp'] = item.get('timestamp')
            existing['date'] = item.get('date')
            existing['id'] = existing.get('id') or item.get('id')
    return sorted(merged, key=lambda proposal: proposal.get('timestamp', 0), reverse=True)


app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')
app.config.update(get_config())


@app.errorhandler(RepositoryError)
def handle_repository_error(exc):
    return json_error(f'Data backend error: {exc}', 500)


@app.get('/api/bootstrap')
def bootstrap():
    return jsonify({
        'ok': True,
        'catalog': repo().get_catalog() or copy.deepcopy(DEFAULT_CATALOG),
        'plans': repo().get_plans() or copy.deepcopy(DEFAULT_PLANS),
        'has_admin': bool(repo().get_admin_auth()),
    })


@app.post('/api/admin/setup')
def setup_admin():
    payload = request.get_json(silent=True) or {}
    key = (payload.get('key') or '').strip()
    if len(key) < 6:
        return json_error('Admin key must be at least 6 characters.')
    salt = generate_salt()
    repo().save_admin_auth({'salt': salt, 'hash': hash_admin_key(key, salt)})
    return jsonify({'ok': True})


@app.post('/api/admin/login')
def admin_login():
    payload = request.get_json(silent=True) or {}
    key = payload.get('key') or ''
    admin_auth = repo().get_admin_auth()
    if not admin_auth:
        return json_error('Admin key has not been configured yet.', 404)
    is_valid = hash_admin_key(key, admin_auth['salt']) == admin_auth['hash']
    return jsonify({'ok': True, 'authenticated': is_valid})


@app.put('/api/admin/key')
def change_admin_key():
    payload = request.get_json(silent=True) or {}
    current_key = payload.get('current_key') or ''
    new_key = (payload.get('new_key') or '').strip()
    admin_auth = repo().get_admin_auth()
    if not admin_auth:
        return json_error('Admin key has not been configured yet.', 404)
    if hash_admin_key(current_key, admin_auth['salt']) != admin_auth['hash']:
        return json_error('Current admin key is incorrect.', 401)
    if len(new_key) < 6:
        return json_error('New admin key must be at least 6 characters.')
    salt = generate_salt()
    repo().save_admin_auth({'salt': salt, 'hash': hash_admin_key(new_key, salt)})
    return jsonify({'ok': True})


@app.put('/api/catalog')
def save_catalog():
    payload = request.get_json(silent=True) or {}
    items = payload.get('items')
    if not isinstance(items, list):
        return json_error('Catalog payload must include an items array.')
    return jsonify({'ok': True, 'items': repo().save_catalog(items)})


@app.put('/api/plans')
def save_plans():
    payload = request.get_json(silent=True) or {}
    items = payload.get('items')
    if not isinstance(items, list):
        return json_error('Plans payload must include an items array.')
    return jsonify({'ok': True, 'items': repo().save_plans(items)})


@app.get('/api/proposals')
def get_proposals():
    proposals = normalize_proposals(repo().get_proposals() or [])
    cutoff = int(time.time() * 1000) - (90 * 24 * 60 * 60 * 1000)
    proposals = [item for item in proposals if item.get('timestamp', 0) > cutoff]
    repo().save_proposals(proposals)
    return jsonify({'ok': True, 'items': proposals})


@app.put('/api/proposals')
def save_proposals():
    payload = request.get_json(silent=True) or {}
    items = payload.get('items')
    if not isinstance(items, list):
        return json_error('Proposal payload must include an items array.')
    items = normalize_proposals(items)[:500]
    return jsonify({'ok': True, 'items': repo().save_proposals(items)})


@app.get('/health')
def health_check():
    return jsonify({'ok': True})


@app.get('/')
def root():
    return send_from_directory(app.static_folder, 'index.html')


@app.get('/<path:path>')
def static_proxy(path):
    full_path = Path(app.static_folder, path)
    if full_path.exists() and full_path.is_file():
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
