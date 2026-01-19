const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, email: String, balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false }, step: { type: String, default: 'IDLE' },
    selectedItem: String, selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'EN ATTENTE' }, proxyData: String, date: { type: Date, default: Date.now }
}));

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    if (text === "Return to main menu") return sendMenu(psid, user);

    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Choose a password:"); }
    if (user.step === 'SIGNUP_PASS') { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
    
    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Please enter a valid number.");
        if (user.selectedItem === 'VIRGIN' && qty < 10) return sendText(psid, "⚠️ Minimum 10 pieces for Virgin. Please enter 10 or more:");

        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `🛒 Order: ${qty}x ${user.selectedItem}\n💰 Total: $${total.toFixed(2)}`, [
            { "title": "Confirm", "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter Email:"); }
    if (!user.isLoggedIn) return sendAuth(psid);

    // --- MENU PRINCIPAL ---
    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Select Category:", [
            { "title": "⚡ Static ISP ($5)", "payload": "MENU_STATIC" },
            { "title": "🏠 Virgin Resi ($5)", "payload": "MENU_VIRGIN" },
            { "title": "📍 Verizon ($3.5)", "payload": "MENU_VERIZON" }
        ]);
    }

    // --- SOUS-MENUS AVEC BOUTON INFO POUR CHAQUE TYPE ---
    if (payload === 'MENU_STATIC') {
        return sendButtons(psid, "⚡ Static ISP ($5.00)\nHigh speed, renewable.", [
            { "title": "🛒 Buy Static", "payload": "BUY_STATIC_5.0" },
            { "title": "ℹ️ Info", "payload": "INFO_STATIC" },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    if (payload === 'MENU_VIRGIN') {
        return sendButtons(psid, "🏠 Virgin Residential ($5.00)\nBrand new IPs. Min: 10.", [
            { "title": "🛒 Buy Virgin", "payload": "BUY_VIRGIN_5.0" },
            { "title": "ℹ️ Info", "payload": "INFO_VIRGIN" },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    if (payload === 'MENU_VERIZON') {
        return sendButtons(psid, "📍 Verizon Static ($3.50)\nHigh quality, non-renewable.", [
            { "title": "🛒 Buy Verizon", "payload": "BUY_VERIZON_3.5" },
            { "title": "ℹ️ Info", "payload": "INFO_VERIZON" },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    // --- TEXTES INFO SPÉCIFIQUES ---
    if (payload === 'INFO_STATIC') return sendText(psid, "ℹ️ STATIC ISP:\n- Locations: USA, UK, AUS\n- Best for: Social Media / Gaming\n- Renewable: Yes.");
    if (payload === 'INFO_VIRGIN') return sendText(psid, "ℹ️ VIRGIN RESI:\n- AT&T (HTTP) or Windstream (SOCKS5)\n- Quality: 100% Never used before\n- Min order: 10 IPs.");
    if (payload === 'INFO_VERIZON') return sendText(psid, "ℹ️ VERIZON:\n- Type: Static Residential\n- Regions: VA, WA, NY, IL\n- Renewable: No.");

    // --- COMMANDE ---
    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item;
        user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY'; await user.save();
        return sendText(psid, `How many ${item} proxies do you want? ${item === 'VIRGIN' ? '(Min: 10)' : ''}`);
    }

    // --- COMPTE & HISTORIQUE ---
    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Balance: ${user.balance.toFixed(2)}$`, [
            { "title": "➕ Add Funds", "payload": "ADD_FUNDS" },
            { "title": "📜 History", "payload": "MY_ORDERS" },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    if (payload === 'MY_ORDERS') {
        const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
        if (orders.length === 0) return sendText(psid, "📜 No history found.");
        let msg = "📜 History:\n";
        orders.forEach(o => msg += `\n${o.status === 'LIVRÉ' ? '✅':'⏳'} ${o.provider}\nStatus: ${o.status}\n---`);
        return sendText(psid, msg);
    }

    if (payload === 'ADD_FUNDS') {
        return sendButtons(psid, "💳 Send payment to Binance ID or LTC.\nContact support with your proof.", [{ "title": "👨‍💻 Contact Support", "url": SUPPORT_LINK }]);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        const cost = parseFloat(total);
        if (user.balance >= cost) {
            user.balance -= cost;
            const oid = "PF" + Math.floor(Math.random()*99999);
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost });
            await user.save();
            return sendText(psid, `✅ Order ${oid} placed! Admin will deliver soon.`);
        }
        return sendText(psid, "❌ Insufficient balance.");
    }
}

// --- HELPERS (Quick Replies & API) ---
function sendMenu(psid, user) {
    callAPI(psid, {
        attachment: { type: "template", payload: { 
            template_type: "button", text: `ProxyFlow Menu\nBalance: ${user.balance.toFixed(2)}$`,
            buttons: [{ type: "postback", title: "🛒 Buy", payload: "START_ORDER" }, { type: "postback", title: "👤 Account", payload: "MY_ACCOUNT" }]
        }}
    });
}

function sendText(psid, text) {
    callAPI(psid, { 
        text: text, 
        quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }]
    });
}

function sendButtons(psid, text, b) {
    const btns = b.map(x => x.url ? { type: "web_url", title: x.title, url: x.url } : { type: "postback", title: x.title, payload: x.payload });
    callAPI(psid, {
        attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } },
        quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }]
    });
}

function sendAuth(psid) { sendButtons(psid, "ProxyFlow 🌐", [{ "title": "Signup", "payload": "GOTO_SIGNUP" }]); }

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(()=>{});
}

// WEBHOOK & PORT
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']); });
app.post('/webhook', async (req, res) => {
    let event = req.body.entry[0].messaging[0];
    let psid = event.sender.id;
    let user = await User.findOne({ psid }) || await User.create({ psid });
    if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
    else if (event.postback) handlePostback(psid, event.postback.payload, user);
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000);
