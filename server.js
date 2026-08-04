const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CẤU HÌNH SUPABASE 
// Bạn có thể điền trực tiếp hoặc cấu hình Environment Variables trên Render
const SUPABASE_URL = process.env.SUPABASE_URL || "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "YOUR_SUPABASE_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const VUOTNHANH_API_KEY = "111bd2ec-fac7-4a23-876d11c19b29"; 

const getDomain = (req) => {
    const host = req.get('host');
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
        return `${req.protocol}://${host}`;
    }
    return `https://${host}`;
};

Lưu Session tạm thời trên RAM (vì Session hết hạn rất nhanh)
let activeSessions = {};

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/getkey', (req, res) => res.sendFile(path.join(__dirname, 'public', 'getkey.html')));

// ==========================================
// --- API ADMIN (KẾT NỐI SUPABASE) ---
// ==========================================

// Lấy danh sách Key từ Supabase
app.get('/api/admin/keys', async (req, res) => {
    const { data, error } = await supabase.from('keys').select('*');
    if (error) return res.status(500).json({ error: error.message });
    
     Format dữ liệu trả về cho khớp với Frontend của bạn
    const formattedData = data.map(k => ({
        key: k.key,
        durationHours: k.duration_hours,
        maxDevices: k.max_devices,
        hwids: k.hwids || [],
        expiresAt: k.expires_at,
        banned: k.banned
    }));
    
    res.json(formattedData);
});

 Tạo Key mới vào Supabase
app.post('/api/admin/create-key', async (req, res) => {
    const { key, durationHours, maxDevices } = req.body;
    
    const { error } = await supabase.from('keys').insert([
        {
            key: key,
            duration_hours: durationHours ? parseFloat(durationHours) : null,
            max_devices: parseInt(maxDevices) || 1,
            hwids: [],
            expires_at: null,
            banned: false
        }
    ]);

    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true });
});

 Thao tác cấm/xoá/reset HWID
app.post('/api/admin/action-key', async (req, res) => {
    const { key, action } = req.body;

    const { data: keyData, error: fetchErr } = await supabase.from('keys').select('*').eq('key', key).single();
    if (fetchErr || !keyData) return res.status(404).json({ error: "Không tìm thấy key" });

    if (action === 'ban') {
        await supabase.from('keys').update({ banned: !keyData.banned }).eq('key', key);
    } else if (action === 'reset_hwid') {
        await supabase.from('keys').update({ hwids: [] }).eq('key', key);
    } else if (action === 'delete') {
        await supabase.from('keys').delete().eq('key', key);
    }

    res.json({ success: true });
});

// ==========================================
// --- API GET KEY ---
// ==========================================

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
    if (!session || !activeSessions[session]) {
        return res.status(400).json({ status: 'error', message: 'Session lỗi hoặc đã hết hạn!' });
    }

    const domain = getDomain(req);
    const targetUrl = encodeURIComponent(`${domain}/getkey?session=${session}&verify=true`);
    const apiUrl = `https://vuotnhanh.com/api?api=${VUOTNHANH_API_KEY}&url=${targetUrl}`;

    try {
        const response = await axios.get(apiUrl);
        if (response.data && response.data.status === 'success') {
            res.json({ status: 'success', shortenedUrl: response.data.shortenedUrl });
        } else {
            res.json({ status: 'error', message: response.data?.message || 'Không tạo được link rút gọn!' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Lỗi API VuotNhanh' });
    }
});

app.get('/api/claim-key', async (req, res) => {
    const { session, verify } = req.query;
    const sessionData = activeSessions[session];

    if (!sessionData) return res.json({ status: 'error', message: 'Phiên làm việc hết hạn!' });
    if (verify !== 'true' && sessionData.status !== 'completed') return res.json({ status: 'error', message: 'Chưa vượt link!' });

    if (sessionData.status === 'completed' && sessionData.key) {
        return res.json({ status: 'success', key: sessionData.key });
    }

     Tìm Key khả dụng từ Supabase
    const { data: availableKeys, error } = await supabase
        .from('keys')
        .select('*')
        .eq('banned', false);

    if (error || !availableKeys) return res.json({ status: 'error', message: 'Lỗi truy vấn dữ liệu!' });

    const availableKey = availableKeys.find(k => (k.hwids || []).length < k.max_devices);
    if (!availableKey) return res.json({ status: 'troll', message: 'Hệ thống hết Key! Vui lòng báo Admin tạo thêm.' });

    sessionData.status = 'completed';
    sessionData.key = availableKey.key;
    res.json({ status: 'success', key: availableKey.key });
});

// ==========================================
// --- API VERIFY KEY CHO ROBLOX (SUPABASE) ---
// ==========================================

app.post('/api/verify-key', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.json({ success: false, message: "Thiếu thông tin!" });

     Lấy thông tin Key từ Supabase
    const { data: keyData, error } = await supabase
        .from('keys')
        .select('*')
        .eq('key', key)
        .single();

    if (error || !keyData) return res.json({ success: false, message: "Key không tồn tại!" });
    if (keyData.banned) return res.json({ success: false, message: "Key bị BANNED!" });

    if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
        return res.json({ success: false, message: "Key đã HẾT HẠN!" });
    }

    let hwids = keyData.hwids || [];
    let expiresAt = keyData.expires_at;

    if (!hwids.includes(hwid)) {
        if (hwids.length >= keyData.max_devices) {
            return res.json({ success: false, message: "Key đã hết lượt dùng trên thiết bị khác!" });
        }
        
        hwids.push(hwid);

         Tính thời gian hết hạn nếu lần đầu dùng
        if (keyData.duration_hours && !expiresAt) {
            const now = new Date();
            now.setHours(now.getHours() + keyData.duration_hours);
            expiresAt = now.toISOString();
        }

         Cập nhật HWID và Expiration vào Supabase
        await supabase
            .from('keys')
            .update({ hwids: hwids, expires_at: expiresAt })
            .eq('key', key);
    }

    let remainingSeconds = null;
    if (expiresAt) {
        remainingSeconds = Math.max(0, Math.floor((new Date(expiresAt) - new Date()) / 1000));
    }

    res.json({ success: true, message: "Xác thực thành công!", remainingSeconds });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
