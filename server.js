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

// ==========================================
// 1. LUỒNG LẤY KEY & XÁC THỰC CHO NGƯỜI DÙNG
// ==========================================

// Script Roblox gọi API khi bấm "Get Key" -> Sinh Token
app.post('/api/init-getkey', async (req, res) => {
    const { hwid } = req.body;
    if (!hwid) return res.status(400).json({ error: 'Thiếu HWID' });

    const token = crypto.randomBytes(16).toString('hex');

    const { error } = await supabase.from('pending_tokens').insert({ token, hwid });
    if (error) return res.status(500).json({ error: 'Lỗi khởi tạo Token' });

    res.json({ link: `${DOMAIN}/getkey.html?token=${token}` });
});

// Trang getkey.html gọi khi nhấn "Lấy Key Ngay" -> Rút gọn link
app.get('/api/get-link', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Thiếu Token' });

    const { data: pending } = await supabase.from('pending_tokens').select('*').eq('token', token).single();
    if (!pending) return res.status(400).json({ error: 'Token không hợp lệ hoặc đã hết hạn!' });

    const targetUrl = `${DOMAIN}/verify.html?token=${token}`;

    try {
        const response = await axios.get(`https://vuotnhanh.com/api?api=${API_VUOTNHANH}&url=${encodeURIComponent(targetUrl)}&format=text`);
        res.json({ shortUrl: response.data });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi tạo link từ VuotNhanh' });
    }
});

// Trang verify.html gọi để cấp Key chuẩn (CHỈ CẤP KEY THƯỜNG SINGLE-USE)
app.get('/api/claim-key', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Thiếu Token xác nhận!' });

    const { data: pending } = await supabase.from('pending_tokens').select('*').eq('token', token).single();
    if (!pending) {
        return res.status(400).json({ message: 'Bạn chưa vượt link hoặc Token đã sử dụng!' });
    }

    const hwid = pending.hwid;

    // CHỈ LẤY KEY THƯỜNG (single), CHƯA DÙNG VÀ KHÔNG BỊ BANNED
    const { data: unusedKeys } = await supabase
        .from('keys')
        .select('*')
        .eq('status', 'unused')
        .eq('is_banned', false)
        .eq('key_type', 'single') // Đảm bảo tuyệt đối không động vào Key VIP/Event
        .limit(1);

    if (!unusedKeys || unusedKeys.length === 0) {
        return res.status(400).json({ message: 'Hệ thống tạm hết Key thường! Vui lòng liên hệ Admin.' });
    }

    const selectedKey = unusedKeys[0];
    const expiresAt = new Date(Date.now() + selectedKey.duration_hours * 3600 * 1000);

    // Cập nhật trạng thái Key Thường
    await supabase.from('keys').update({ 
        status: 'active',
        used_count: 1 
    }).eq('id', selectedKey.id);

    // Lưu phiên kích hoạt kèm HWID
    await supabase.from('active_sessions').upsert({
        hwid: hwid,
        key_code: selectedKey.key_code,
        expires_at: expiresAt,
        is_banned: false
    });

    // Xóa Token đã dùng
    await supabase.from('pending_tokens').delete().eq('token', token);

    res.json({ key: selectedKey.key_code });
});

// Script Roblox gọi khi bấm "Login" (Hỗ trợ cả Key Thường & Key VIP Multi-Device)
app.post('/api/verify-login', async (req, res) => {
    const { hwid, key } = req.body;
    if (!hwid || !key) return res.json({ success: false, message: 'Thiếu thông tin đăng nhập!' });

    // 1. Kiểm tra Key có tồn tại hoặc bị BAN không
    const { data: keyData } = await supabase.from('keys').select('*').eq('key_code', key).single();
    if (!keyData) return res.json({ success: false, message: 'Key không tồn tại!' });
    if (keyData.is_banned) return res.json({ success: false, message: 'Key này đã bị BANNED!' });

    // 2. Kiểm tra xem thiết bị HWID này đã kích hoạt Key này trước đó chưa
    const { data: session } = await supabase
        .from('active_sessions')
        .select('*')
        .eq('hwid', hwid)
        .eq('key_code', key)
        .single();

    if (session) {
        // Nếu thiết bị đã từng nhập Key này
        if (session.is_banned) {
            return res.json({ success: false, message: 'Thiết bị (HWID) của bạn đã bị BANNED!' });
        }
        if (new Date() > new Date(session.expires_at)) {
            return res.json({ success: false, message: 'Key của bạn đã hết hạn sử dụng!' });
        }
        return res.json({ success: true, message: 'Đăng nhập thành công!' });
    }

    // 3. Nếu là THIẾT BỊ MỚI chưa từng kích hoạt Key này -> Kiểm tra số lượt đếm của Key
    const currentUsed = keyData.used_count || 0;
    const maxUses = keyData.max_uses || 1;

    if (currentUsed >= maxUses) {
        return res.json({ success: false, message: 'Key này đã hết lượt kích hoạt cho thiết bị mới!' });
    }

    // 4. Kích hoạt thiết bị mới thành công
    const expiresAt = new Date(Date.now() + keyData.duration_hours * 3600 * 1000);

    await supabase.from('active_sessions').insert({
        hwid: hwid,
        key_code: key,
        expires_at: expiresAt,
        is_banned: false
    });

    // Cập nhật số lượt máy đã dùng (+1) và chuyển trạng thái nếu đủ máy
    const newUsedCount = currentUsed + 1;
    await supabase.from('keys').update({
        used_count: newUsedCount,
        status: newUsedCount >= maxUses ? 'active' : 'unused'
    }).eq('id', keyData.id);

    res.json({ success: true, message: 'Kích hoạt thiết bị thành công!' });
});


// ==========================================
// 2. TẤT CẢ API DÀNH CHO ADMIN DASHBOARD
// ==========================================

// Hàm middleware kiểm tra tài khoản Admin
async function verifyAdmin(username, password) {
    if (!username || !password) return false;
    const { data: admin } = await supabase
        .from('admin_users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();
    return !!admin;
}

// API thêm Key mới (Hỗ trợ phân loại Key Thường & Key VIP Event)
app.post('/api/admin/add-key', async (req, res) => {
    const { username, password, key_code, duration_hours, max_uses, key_type } = req.body;

    if (!(await verifyAdmin(username, password))) {
        return res.status(403).json({ error: 'Sai tài khoản hoặc mật khẩu Admin!' });
    }

    const isVip = key_type === 'vip';
    const finalMaxUses = isVip ? (parseInt(max_uses) || 1) : 1; // Key Thường luôn ép cứng 1 thiết bị

    const { error } = await supabase.from('keys').insert({
        key_code: key_code.trim(),
        duration_hours: parseInt(duration_hours) || 24,
        max_uses: finalMaxUses,
        used_count: 0,
        key_type: isVip ? 'vip' : 'single',
        status: 'unused',
        is_banned: false
    });

    if (error) return res.status(400).json({ error: 'Key đã tồn tại hoặc lỗi dữ liệu!' });

    res.json({ success: true, message: isVip ? `Đã tạo Key VIP (${finalMaxUses} máy)!` : 'Đã tạo Key Thường (1 máy)!' });
});

// API lấy toàn bộ danh sách Key & Mã thiết bị HWID
app.post('/api/admin/list-keys', async (req, res) => {
    const { username, password } = req.body;

    if (!(await verifyAdmin(username, password))) {
        return res.status(403).json({ error: 'Chưa đăng nhập hoặc sai thông tin Admin!' });
    }

    const { data: keys } = await supabase.from('keys').select('*').order('created_at', { ascending: false });
    const { data: sessions } = await supabase.from('active_sessions').select('*');

    res.json({ keys: keys || [], sessions: sessions || [] });
});

// API Khóa (Ban) hoặc Gỡ Khóa (Unban) Key & HWID
app.post('/api/admin/toggle-ban', async (req, res) => {
    const { username, password, key_code, is_banned } = req.body;

    if (!(await verifyAdmin(username, password))) {
        return res.status(403).json({ error: 'Lỗi xác thực Admin!' });
    }

    await supabase.from('keys').update({ is_banned }).eq('key_code', key_code);
    await supabase.from('active_sessions').update({ is_banned }).eq('key_code', key_code);

    res.json({ success: true, message: is_banned ? 'Đã BAN Key!' : 'Đã GỠ BAN Key!' });
});

// API Xóa hoàn toàn Key khỏi Database
app.post('/api/admin/delete-key', async (req, res) => {
    const { username, password, key_code } = req.body;

    if (!(await verifyAdmin(username, password))) {
        return res.status(403).json({ error: 'Lỗi xác thực Admin!' });
    }

    await supabase.from('keys').delete().eq('key_code', key_code);
    await supabase.from('active_sessions').delete().eq('key_code', key_code);

    res.json({ success: true, message: 'Đã xóa Key khỏi hệ thống!' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
