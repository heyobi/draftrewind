const fs = require('fs');
const path = require('path');

// Elektrik kesintisinde yarım dosya kalmaması için: geçici dosyaya yaz, diske zorla, sonra yeniden adlandır.
function atomicWriteFileSync(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, 'w');
    try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
}

class Store {
    constructor(file, safeStorage) {
        this.file = file;
        this.safeStorage = safeStorage;
        this.data = this._load();
    }

    _load() {
        for (const f of [this.file, `${this.file}.bak`]) {
            try {
                return JSON.parse(fs.readFileSync(f, 'utf8'));
            } catch (e) {}
        }
        return {};
    }

    save() {
        try {
            if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
        } catch (e) {}
        atomicWriteFileSync(this.file, JSON.stringify(this.data, null, 2));
    }

    get(key, fallback) {
        return this.data[key] === undefined ? fallback : this.data[key];
    }

    set(key, value) {
        if (value === undefined) delete this.data[key];
        else this.data[key] = value;
        this.save();
    }

    // Jetonlar Windows kullanıcı hesabına bağlı olarak şifrelenir (DPAPI).
    getSecret(key) {
        const raw = this.data.secrets && this.data.secrets[key];
        if (!raw) return null;
        try {
            if (raw.startsWith('enc:')) return this.safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
            if (raw.startsWith('raw:')) return raw.slice(4);
        } catch (e) {}
        return null;
    }

    setSecret(key, value) {
        this.data.secrets = this.data.secrets || {};
        if (value == null) {
            delete this.data.secrets[key];
        } else if (this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
            this.data.secrets[key] = 'enc:' + this.safeStorage.encryptString(String(value)).toString('base64');
        } else {
            this.data.secrets[key] = 'raw:' + value;
        }
        this.save();
    }
}

module.exports = { Store, atomicWriteFileSync };
