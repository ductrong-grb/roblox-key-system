const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Kết nối Supabase
const supabase = createClient(
    'https://xoossdghherkqbqxbuiz.supabase.co', 
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvb3NzZGdoaGVya3FicXhidWl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NDY3NDcsImV4cCI6MjEwMTQyMjc0N30.2ZTq_C-BifftVbLXrvDdysaHWPiJ7MFgomZfoIXlnOw'
);

const API_VUOTNHANH = '111bd2ec-fac7-4a23-8173-876d11c19b29';
const DOMAIN = 'https://roblox-key-system-45ga.onrender.com';

// 1. Script Roblox gọi API này khi bấm "Get Key" -> Sinh Token & Trả về Link GetKey
app.post('/api/init-getkey', async (req, res) => {
    const { hwid } = req.body;
    if (!hwid) return res.status(400).json({ error: 'Thiếu HWID' });

    // Tạo token ngẫu nhiên độc quyền cho phiên lấy key này
    const token = crypto.randomBytes(16).toString('hex');

    // Lưu Token + HWID vào bảng pending_tokens
    const { error } = await supabase.from('pending_tokens').insert({ token, hwid });
    if (error) return res.status(500).json({ error: 'Lỗi khởi tạo Token' });

    // Trả về đường dẫn GetKey có chứa Token
    res.json({ link: `${DOMAIN}/getkey.html?token=${token}` });
});

// 2. Trang getkey.html gọi khi người dùng bấm "Lấy Key Ngay" -> Tạo link rút gọn VuotNhanh
app.get('/api/get-link', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Thiếu Token' });

    // Kiểm tra Token xem có hợp lệ không
    const { data: pending } = await supabase.from('pending_tokens').select('*').eq('token', token).single();
    if (!pending) return res.status(400).json({ error: 'Token không hợp lệ hoặc đã hết hạn!' });

    // Sau khi vượt xong, VuotNhanh sẽ chuyển hướng về verify.html KÈM TOKEN
    const targetUrl = `${DOMAIN}/verify.html?token=${token}`;

    try {
        const response = await axios.get(`https://vuotnhanh.com/api?api=${API_VUOTNHANH}&url=${encodeURIComponent(targetUrl)}&format=text`);
        res.json({ shortUrl: response.data });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi tạo link từ VuotNhanh' });
    }
});

// 3. Trang verify.html gọi để lấy Key (BẮT BUỘC có Token chuẩn mới nhả Key)
app.get('/api/claim-key', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Thiếu Token xác nhận!' });

    // Kiểm tra Token từ bảng pending_tokens
    const { data: pending } = await supabase.from('pending_tokens').select('*').eq('token', token).single();
    if (!pending) {
        return res.status(400).json({ message: 'Bạn chưa vượt link hoặc Token đã sử dụng!' });
    }

    const hwid = pending.hwid;

    // Lấy 1 Key chưa dùng do Admin tạo sẵn từ DB
    const { data: unusedKeys } = await supabase
        .from('keys')
        .select('*')
        .eq('status', 'unused')
        .limit(1);

    if (!unusedKeys || unusedKeys.length === 0) {
        return res.status(400).json({ message: 'Hệ thống tạm hết Key! Vui lòng liên hệ Admin.' });
    }

    const selectedKey = unusedKeys[0];
    const expiresAt = new Date(Date.now() + selectedKey.duration_hours * 3600 * 1000);

    // Cập nhật trạng thái Key thành 'active'
    await supabase.from('keys').update({ status: 'active' }).eq('id', selectedKey.id);

    // Lưu thông tin kích hoạt vào active_sessions
    await supabase.from('active_sessions').upsert({
        hwid: hwid,
        key_code: selectedKey.key_code,
        expires_at: expiresAt
    });

    // Xóa Token cũ để không ai dùng lại link verify được nữa
    await supabase.from('pending_tokens').delete().eq('token', token);

    res.json({ key: selectedKey.key_code });
});

// 4. Script Roblox gọi khi nhấn nút "Login"
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
        return res.json({ success: false, message: 'Key đã hết hạn sử dụng!' });
    }

    res.json({ success: true, message: 'Đăng nhập thành công!' });
});

// 5. API cho trang Web Admin tự tạo Key thủ công
app.post('/api/admin/add-key', async (req, res) => {
    const { username, password, key_code, duration_hours } = req.body;

    // Xác thực Admin
    const { data: admin } = await supabase
        .from('admin_users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();

    if (!admin) {
        return res.status(403).json({ error: 'Sai tài khoản hoặc mật khẩu Admin!' });
    }

    // Thêm key mới vào DB
    const { error } = await supabase.from('keys').insert({
        key_code: key_code,
        duration_hours: duration_hours || 24,
        status: 'unused'
    });

    if (error) {
        return res.status(400).json({ error: 'Key đã tồn tại hoặc bị lỗi!' });
    }

    res.json({ success: true, message: 'Đã thêm Key thành công!' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
