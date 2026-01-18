const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI).then(() => console.log("✅ Bot DB Connecté"));

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String,
    paymentRef: String, status: { type: String, default: 'EN ATTENTE' },
    proxyData: String, expiresAt: Date, date: { type: Date, default: Date.now }
}));

// --- WEBHOOK ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === 'proxyflow_secret_2026') res.status(200).send(req.query['hub.challenge']);
});

app.post('/webhook', async (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            let event = entry.messaging[0];
            let psid = event.sender.id;
            let user = await User.findOne({ psid }) || await User.create({ psid });

            if (event.message && event.message.text) {
                handleMessage(psid, event.message.text, user);
            } else if (event.postback) {
                handlePostback(psid, event.postback.payload, user);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    }
});

// --- LOGIQUE TEXTE ---
async function handleMessage(psid, text, user) {
    // Inscription / Connexion
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Mot de passe :"); }
    if (user.step === 'SIGNUP_PASS') { 
        user.password = text; const n1 = Math.floor(Math.random()*10), n2 = Math.floor(Math.random()*10);
        user.captchaAnswer = n1 + n2; user.step = 'SIGNUP_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 Captcha : ${n1} + ${n2} = ?`);
    }
    if (user.step === 'SIGNUP_CAPTCHA') {
        if (parseInt(text) === user.captchaAnswer) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
        return sendText(psid, "❌ Faux. Réessayez.");
    }
    if (user.step === 'LOGIN_EMAIL') { user.email = text; user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "🔑 Mot de passe :"); }
    if (user.step === 'LOGIN_PASS') {
        const acc = await User.findOne({ email: user.email, password: text });
        if (acc) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user); }
        return sendText(psid, "❌ Erreur.");
    }

    // Réception ID de paiement (Binance/LTC)
    if (user.step === 'AWAITING_PAYMENT_ID') {
        const lastOrder = await Order.findOne({ psid: user.psid, status: 'EN ATTENTE' }).sort({ date: -1 });
        if (lastOrder) { lastOrder.paymentRef = text; await lastOrder.save(); }
        user.step = 'IDLE'; await user.save();
        return sendText(psid, "✅ ID reçu ! Un admin va vérifier sur le Dashboard.");
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 ${user.email}\n💰 Solde : ${user.balance}$`, [
            { "title": "📡 Mes Proxys", "payload": "MY_PROXIES" },
            { "title": "➕ Recharger", "payload": "ADD_FUNDS" },
            { "title": "📜 Historique", "payload": "MY_ORDERS" }
        ]);
    }

    if (payload === 'MY_PROXIES') {
        const active = await Order.find({ psid, status: 'LIVRÉ', expiresAt: { $gt: new Date() } });
        if (active.length === 0) return sendText(psid, "❌ Aucun proxy actif.");
        let m = "📡 Vos Proxys :\n";
        active.forEach(p => m += `\n📍 ${p.provider}\n🔑 ${p.proxyData}\n⏳ Expire: ${Math.ceil((p.expiresAt-new Date())/(1000*60*60*24))}j\n---`);
        return sendText(psid, m);
    }

    if (payload === 'ADD_FUNDS') {
        user.step = 'AWAITING_PAYMENT_ID'; await user.save();
        return sendText(psid, "💰 Rechargement (Min 4$)\n\nUSDT Binance ID: 1192024137\n\nTapez votre ID Binance ici :");
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Étape 1 : Pays", [{ "title": "🇺🇸 USA", "payload": "STEP_PROV" }]);
    }

    if (payload === 'STEP_PROV') {
        return sendButtons(psid, "📶 Étape 2 : ISP (4$)", [
            { "title": "Verizon", "payload": "BUY_Verizon" },
            { "title": "T-Mobile", "payload": "BUY_TMobile" }
        ]);
    }

    // --- LOGIQUE D'ACHAT ---
    if (payload.startsWith('BUY_')) {
        const isp = payload.replace('BUY_', '');
        return sendButtons(psid, `💳 Proxy ${isp} (4$)\nPayer par :`, [
            { "title": `💰 Solde (${user.balance}$)`, "payload": `PAY_BAL_${isp}` },
            { "title": "🆔 Binance", "payload": `PAY_BIN_${isp}` },
            { "title": "🚀 LTC", "payload": `PAY_LTC_${isp}` }
        ]);
    }

    // --- PAIEMENT ---
    if (payload.startsWith('PAY_')) {
        const parts = payload.split('_');
        const meth = parts[1];
        const prov = parts[2];
        const oid = "PF" + Math.floor(Math.random()*900000);

        if (meth === 'BAL') {
            if (user.balance >= 4) {
                user.balance -= 4; await user.save();
                const exp = new Date(); exp.setDate(exp.getDate() + 30);
                const proxy = `185.244.11.${Math.floor(Math.random()*255)}:8080:user${oid}:pass123`;
                await Order.create({ psid, orderId: oid, method: 'SOLDE', provider: prov, status: 'LIVRÉ', proxyData: proxy, expiresAt: exp });
                return sendText(psid, `⚡ ACHAT RÉUSSI !\n\n🔑 Accès: ${proxy}\n📅 Expire: ${exp.toLocaleDateString()}\n\nVoir dans "Mes Proxys".`);
            }
            return sendText(psid, "❌ Solde insuffisant.");
        }

        await Order.create({ psid, orderId: oid, method: meth, provider: prov });
        user.step = 'AWAITING_PAYMENT_ID'; await user.save();
        const instr = meth === 'BIN' ? "Binance ID: 1192024137" : "LTC: ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g";
        return sendText(psid, `🛒 Commande ${oid}\n\n${instr}\n\nTapez votre ID de transaction ici :`);
    }
}

// --- HELPERS ---
function sendAuth(psid) { sendButtons(psid, "ProxyFlow 🌐", [{ "title": "Inscrire", "payload": "GOTO_SIGNUP" }, { "title": "Login", "payload": "GOTO_LOGIN" }]); }
function sendMenu(psid, user) { sendButtons(psid, `Menu (Solde: ${user.balance}$)`, [{ "title": "🛒 Acheter", "payload": "START_ORDER" }, { "title": "👤 Compte", "payload": "MY_ACCOUNT" }]); }
function sendText(psid, text) { callAPI(psid, { text }); }
function sendButtons(psid, text, b) {
    const btns = b.map(x => ({ type: "postback", title: x.title, payload: x.payload }));
    callAPI(psid, { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } });
}
function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(e => {});
}

app.listen(process.env.PORT || 3000);
