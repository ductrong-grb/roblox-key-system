const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// Load các file HTML/JS tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

const VUOTNHANH_API_KEY = "111bd2ec-fac7-4a23-876d11c19b29"; 

// BẮT BUỘC: Lấy Domain tự động khi chạy trên Render
const getDomain = (req) => `${req.protocol}://${req.get('host')}`;

let keysDatabase = [];
let activeSessions = {};

// Direct route cho Admin & Getkey
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/getkey', (req, res) => res.sendFile(path.join(__dirname, 'public', 'getkey.html')));

// --- API ADMIN ---
app.get('/api/admin/keys', (req, res) => res.json(keysDatabase));

app.post('/api/admin/create-key', (req, res) => {
    const { key, durationHours, maxDevices } = req.body;
    keysDatabase.push({
        key: key,
        durationHours: durationHours ? parseFloat(durationHours) : null,
        maxDevices: parseInt(maxDevices) || 1,
        hwids: [],
        expiresAt: null,
        banned: false
    });
    res.json({ success: true });
});

app.post('/api/admin/action-key', (req, res) => {
    const { key, action } = req.body;
    const k = keysDatabase.find(x => x.key === key);
    if (!k) return res.status(404).json({ error: "Không tìm thấy key" });

    if (action === 'ban') k.banned = !k.banned;
    if (action === 'reset_hwid') k.hwids = [];
    if (action === 'delete') keysDatabase = keysDatabase.filter(x => x.key !== key);
    res.json({ success: true });
});

// --- API GET KEY ---
app.post('/api/init-getkey', (req, res) => {
    const { hwid } = req.body;
    if (!hwid) return res.status(400).json({ error: "Thiếu HWID" });

    const sessionId = 'SES_' + Math.random().toString(36).substring(2, 10);
    activeSessions[sessionId] = { hwid, status: 'pending', key: null };

    const domain = getDomain(req);
    res.json({ sessionId, getKeyUrl: `${domain}/getkey?session=${sessionId}` });
});

app.get('/api/request-shortlink', async (req, res) => {
    const { session } = req.query;
    if (!session || !activeSessions[session]) return res.status(400).json({ status: 'error', message: 'Session lỗi!' });

    const domain = getDomain(req);
    const targetUrl = encodeURIComponent(`${domain}/getkey?session=${session}&verify=true`);
    const apiUrl = `https://vuotnhanh.com/api?api=${VUOTNHANH_API_KEY}&url=${targetUrl}`;

    try {
        const response = await axios.get(apiUrl);
        if (response.data && response.data.status === 'success') {
            res.json({ status: 'success', shortenedUrl: response.data.shortenedUrl });
        } else {
            res.json({ status: 'error', message: 'Không tạo được link rút gọn!' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Lỗi API VuotNhanh' });
    }
});

app.get('/api/claim-key', (req, res) => {
    const { session, verify } = req.query;
    const sessionData = activeSessions[session];

    if (!sessionData) return res.json({ status: 'error', message: 'Phiên làm việc hết hạn!' });
    if (verify !== 'true' && sessionData.status !== 'completed') return res.json({ status: 'error', message: 'Chưa vượt link!' });

    if (sessionData.status === 'completed' && sessionData.key) {
        return res.json({ status: 'success', key: sessionData.key });
    }

    const availableKey = keysDatabase.find(k => !k.banned && k.hwids.length < k.maxDevices);
    if (!availableKey) return res.json({ status: 'troll', message: 'Hệ thống hết Key! Vui lòng báo Admin tạo thêm.' });

    sessionData.status = 'completed';
    sessionData.key = availableKey.key;
    res.json({ status: 'success', key: availableKey.key });
});

// --- API VERIFY KEY CHO ROBLOX ---
app.post('/api/verify-key', (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.json({ success: false, message: "Thiếu thông tin!" });

    const keyData = keysDatabase.find(k => k.key === key);
    if (!keyData) return res.json({ success: false, message: "Key không tồn tại!" });
    if (keyData.banned) return res.json({ success: false, message: "Key bị BANNED!" });

    if (keyData.expiresAt && new Date() > new Date(keyData.expiresAt)) {
        return res.json({ success: false, message: "Key đã HẾT HẠN!" });
    }

    if (!keyData.hwids.includes(hwid)) {
        if (keyData.hwids.length >= keyData.maxDevices) {
            return res.json({ success: false, message: "Key đã hết lượt dùng trên thiết bị khác!" });
        }
        keyData.hwids.push(hwid);

        if (keyData.durationHours && !keyData.expiresAt) {
            const now = new Date();
            now.setHours(now.getHours() + keyData.durationHours);
            keyData.expiresAt = now.toISOString();
        }
    }

    let remainingSeconds = null;
    if (keyData.expiresAt) {
        remainingSeconds = Math.max(0, Math.floor((new Date(keyData.expiresAt) - new Date()) / 1000));
    }

    res.json({ success: true, message: "Xác thực thành công!", remainingSeconds });
});

// PORT do Render cấp tự động
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

