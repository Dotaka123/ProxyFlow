const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const ZOHO_CLIENT_ID = "1000.I3OEQYU70DISFITMWSGYZ6S46F1DWD";
const ZOHO_CLIENT_SECRET = "f5d4babb200bf161e5d8e56b496a436afc58ec77c5";
const FROM_EMAIL = "proxyflow@zohomail.com"; 

mongoose.connect(process.env.MONGO_URI);

// --- MODELS ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String, balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    verifyCode: String,
    selectedItem: String, selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'PENDING' }, proxyData: String, date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({ key: String, value: String }));

// --- ZOHO API LOGIC ---
async function getZohoAccessToken() {
    try {
        const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: ZOHO_CLIENT_ID,
                client_secret: ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        return res.data.access_token;
    } catch (e) {
        console.error("Token Refresh Error");
        return null;
    }
}

async function sendVerificationEmail(targetEmail, code) {
    try {
        const token = await getZohoAccessToken();
        if(!token) return false;

        await axios.post(`https://mail.zoho.com/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/messages`, {
            fromAddress: FROM_EMAIL,
            toAddress: targetEmail,
            subject: "ProxyFlow - Verification Code",
            content: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #2ecc71;">ProxyFlow Verification</h2>
                    <p>Welcome to the 0 Fraud Score residential proxy network.</p>
                    <p>Your 6-digit verification code is:</p>
                    <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">
                        ${code}
                    </div>
                    <p style="font-size: 12px; color: #888; margin-top: 20px;">If you didn't request this code, please ignore this email.</p>
                </div>`,
            mailFormat: "html"
        }, { headers: { "Authorization": `Zoho-oauthtoken ${token}` } });
        return true;
    } catch (e) {
        console.error("Zoho Email Error:", e.response ? e.response.data : e.message);
        return false;
    }
}

// --- MESSAGE HANDLING ---
async function handleMessage(psid, text, user) {
    if (text === "Return to main menu") {
        user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // Flux d'inscription
    if (user.step === 'SIGNUP_EMAIL') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text.trim())) return sendText(psid, "❌ Invalid email. Please try again:");
        
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        user.email = text.trim().toLowerCase();
        user.verifyCode = code;
        user.step = 'VERIFY_CODE'; 
        await user.save();

        const sent = await sendVerificationEmail(user.email, code);
        return sendText(psid, sent ? `📧 Verification code sent to ${user.email}. Check your inbox (or spam) and enter it here:` : "⚠️ Email error. Please contact support.");
    }

    if (user.step === 'VERIFY_CODE') {
        if (text.trim() === user.verifyCode) {
            user.step = 'SIGNUP_PASS'; await user.save();
            return sendText(psid, "✅ Email verified! Now choose a password (min. 6 characters):");
        } else {
            return sendText(psid, "❌ Incorrect code. Please check your email again:");
        }
    }

    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 6) return sendText(psid, "⚠️ Password too short! Enter 6+ characters:");
        user.password = text.trim();
        user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendText(psid, "🎊 Registration successful! Welcome to ProxyFlow.");
    }

    // Login
    if (user.step === 'LOGIN_EMAIL') {
        user.email = text.trim().toLowerCase();
        user.step = 'LOGIN_PASS'; await user.save();
        return sendText(psid, "🔐 Enter your password:");
    }
    if (user.step === 'LOGIN_PASS') {
        const account = await User.findOne({ email: user.email });
        if (account && account.password === text.trim()) {
            user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
            return sendMenu(psid, user);
        } else return sendText(psid, "❌ Login failed. Try again:");
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- POSTBACK HANDLING ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your Email to receive a verification code:"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your Email:"); }
    if (payload === 'FREE_PROXY') {
        const data = await Settings.findOne({ key: 'free_proxies' });
        return sendText(psid, "🎁 FREE PROXIES:\n\n" + (data ? data.value : "None available."));
    }

    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 Account: ${user.email}\n💰 Balance: $${user.balance.toFixed(2)}`, [
            { title: "➕ Add Funds", payload: "ADD_FUNDS" },
            { title: "🚪 Logout", payload: "GOTO_SIGNOUT" }
        ]);
    }
    if (payload === 'GOTO_SIGNOUT') { user.isLoggedIn = false; await user.save(); return sendAuth(psid); }
}

// --- HELPERS ---
function sendAuth(psid) {
    sendButtons(psid, "Welcome to ProxyFlow 🌐\nResidential Proxies | 0 Fraud Score", [
        { title: "🔑 Login", payload: "GOTO_LOGIN" },
        { title: "📝 Signup", payload: "GOTO_SIGNUP" },
        { title: "🎁 Free Proxy", payload: "FREE_PROXY" }
    ]);
}

function sendMenu(psid, user) {
    sendButtons(psid, `Main Menu\nBalance: $${user.balance.toFixed(2)}`, [
        { title: "🛒 Buy Proxies", payload: "START_ORDER" },
        { title: "👤 My Account", payload: "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) {
    callAPI(psid, { text, quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }] });
}

function sendButtons(psid, text, b) {
    const btns = b.map(x => ({ type: "postback", title: x.title, payload: x.payload }));
    callAPI(psid, {
        attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } },
        quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }]
    });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

// --- WEBHOOK ---
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']); });
app.post('/webhook', async (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(async entry => {
            let event = entry.messaging[0];
            let psid = event.sender.id;
            let user = await User.findOne({ psid }) || await User.create({ psid });
            if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
            else if (event.postback) handlePostback(psid, event.postback.payload, user);
        });
        res.status(200).send('EVENT_RECEIVED');
    }
});

app.listen(process.env.PORT || 3000, () => console.log("ProxyFlow Bot Live"));
