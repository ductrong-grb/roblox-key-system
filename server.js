const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// CONFIG
const API_TOKEN = "111bd2ec-fac7-4a23-876d11c19b29"; // Mã API lấy từ ảnh của bạn
const DOMAIN = "https://roblox-key-system-mt97.onrender.com"; // Domain hoặc IP VPS của bạn

// Lưu trữ HWID hợp lệ tạm thời (trong thực tế nên dùng Database/Redis)
// Cấu trúc: { "HWID_USER": expire_timestamp }
const activeUsers = {};

// 1. Endpoint tạo Link lấy Key cho Roblox
app.get('/api/get-key-link', async (req, res) => {
    const hwid = req.query.hwid;
    if (!hwid) return res.status(400).json({ error: "Thiếu HWID" });

    // Link đích sau khi vượt xong
    const targetUrl = encodeURIComponent(`${DOMAIN}/verify?hwid=${hwid}`);
    const apiUrl = `https://vuotnhanh.com/api?api=${API_TOKEN}&url=${targetUrl}&format=text`;

    try {
        const response = await axios.get(apiUrl);
        const shortUrl = response.data.trim();
        res.json({ success: true, shortUrl: shortUrl });
    } catch (err) {
        res.status(500).json({ error: "Không thể tạo link VuotNhanh" });
    }
});

// 2. Endpoint xử lý khi người dùng vượt link xong
app.get('/verify', (req, res) => {
    const hwid = req.query.hwid;
    if (!hwid) return res.send("Lỗi: Thiếu HWID!");

    // Cấp quyền cho HWID này sử dụng trong 24 giờ (86,400,000 ms)
    activeUsers[hwid] = Date.now() + 24 * 60 * 60 * 1000;

    res.send(`
        <div style="text-align: center; font-family: sans-serif; margin-top: 50px;">
            <h1 style="color: #2ec4b6;">Kích hoạt thành công!</h1>
            <p>Mã thiết bị (HWID) của bạn đã được xác thực dùng Script trong 24 giờ.</p>
            <p>Bạn có thể quay lại Roblox và nhấn <b>Kiểm Tra / Check Key</b>.</p>
        </div>
    `);
});

// 3. Endpoint cho Roblox Script kiểm tra xem HWID đã vượt link chưa
app.get('/api/check-key', (req, res) => {
    const hwid = req.query.hwid;
    const expireTime = activeUsers[hwid];

    if (expireTime && Date.now() < expireTime) {
        res.json({ status: "valid", message: "Key hợp lệ!" });
    } else {
        res.json({ status: "invalid", message: "Chưa vượt link hoặc Key đã hết hạn!" });
    }
});

app.listen(3000, () => console.log('Server đang chạy tại port 3000'));

