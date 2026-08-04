const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));
// Kết nối Supabase
const supabase = createClient('https://xoossdghherkqbqxbuiz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvb3NzZGdoaGVya3FicXhidWl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NDY3NDcsImV4cCI6MjEwMTQyMjc0N30.2ZTq_C-BifftVbLXrvDdysaHWPiJ7MFgomZfoIXlnOw');
const API_VUOTNHANH = '111bd2ec-fac7-4a23-8173-876d11c19b29'; // Mã API của bạn

// 1. Route khi người dùng nhấn "Lấy Key Ngay" -> Tạo link vượt
app.get('/api/get-link', async (req, res) => {
    const { hwid } = req.query;
    if (!hwid) return res.status(400).json({ error: 'Thiếu HWID' });

    // Link đích sau khi vượt xong sẽ quay về trang xác thực
    const targetUrl = `https://roblox-key-system-45ga.onrender.com/verify.html?hwid=${hwid}`;

    
    try {
        const response = await axios.get(`https://vuotnhanh.com/api?api=${API_VUOTNHANH}&url=${encodeURIComponent(targetUrl)}&format=text`);
        res.json({ shortUrl: response.data });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi tạo link vượt' });
    }
});

// 2. Route xác thực sau khi vượt link xong -> Gán Key từ Admin cho HWID
app.get('/api/claim-key', async (req, res) => {
    const { hwid } = req.query;

    // Lấy 1 key chưa sử dụng từ DB
    const { data: unusedKeys } = await supabase
        .from('keys')
        .select('*')
        .eq('status', 'unused')
        .limit(1);

    if (!unusedKeys || unusedKeys.length === 0) {
        return res.status(400).json({ message: 'Hệ thống tạm hết Key, vui lòng liên hệ Admin!' });
    }

    const selectedKey = unusedKeys[0];
    const expiresAt = new Date(Date.now() + selectedKey.duration_hours * 3600 * 1000);

    // Cập nhật trạng thái Key thành active
    await supabase.from('keys').update({ status: 'active' }).eq('id', selectedKey.id);

    // Lưu vào bảng active_sessions
    await supabase.from('active_sessions').upsert({
        hwid: hwid,
        key_code: selectedKey.key_code,
        expires_at: expiresAt
    });

    res.json({ key: selectedKey.key_code });
});

// 3. Route kiểm tra Key từ Script Roblox (Nút Login)
app.post('/api/verify-login', async (req, res) => {
    const { hwid, key } = req.body;

    const { data: session } = await supabase
        .from('active_sessions')
        .select('*')
        .eq('hwid', hwid)
        .eq('key_code', key)
        .single();

    if (!session) {
        return res.json({ success: false, message: 'Key hoặc thiết bị không hợp lệ!' });
    }

    if (new Date() > new Date(session.expires_at)) {
        return res.json({ success: false, message: 'Key đã hết hạn!' });
    }

    res.json({ success: true, message: 'Đăng nhập thành công!' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
