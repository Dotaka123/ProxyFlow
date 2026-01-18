const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'tata';
const MONGO_URI = 'mongodb+srv://rakotoniainalahatra3_db_user:RXy0cKTSWpXtgCUA@cluster0.gzeshjm.mongodb.net/proxyflow?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connecté"));

// --- MODÈLES MONGODB ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String, status: String, date: { type: Date, default: Date.now }
}));

// --- WEBHOOK ENDPOINTS ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
});

app.post('/webhook', async (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            if (!entry.messaging) continue;
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

// --- LOGIQUE DES MESSAGES TEXTES ---
async function handleMessage(psid, text, user) {
    // 1. Inscription
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Choisissez un mot de passe :"); }
    if (user.step === 'SIGNUP_PASS') { 
        user.password = text; const n1 = Math.floor(Math.random()*10), n2 = Math.floor(Math.random()*10);
        user.captchaAnswer = n1 + n2; user.step = 'SIGNUP_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 Captcha : Combien font ${n1} + ${n2} ?`);
    }
    if (user.step === 'SIGNUP_CAPTCHA') {
        if (parseInt(text) === user.captchaAnswer) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Calcul faux. Réessayez.");
    }

    // 2. Connexion
    if (user.step === 'LOGIN_EMAIL') { user.email = text; user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "🔑 Votre mot de passe :"); }
    if (user.step === 'LOGIN_PASS') {
        const account = await User.findOne({ email: user.email, password: text });
        if (account) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Email ou mot de passe incorrect.");
    }

    // 3. Réception ID Binance
    if (user.step === 'AWAITING_BINANCE_ID') {
        user.step = 'IDLE'; await user.save();
        return sendText(psid, `✅ ID ${text} reçu. Un admin vérifiera votre transfert sous peu.`);
    }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);
    sendWelcomeMenu(psid, user);
}

// --- LOGIQUE DES BOUTONS (POSTBACKS) ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Entrez votre email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Entrez votre email :"); }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);

    switch (payload) {
        case 'MY_ACCOUNT':
            return sendButtons(psid, `👤 ${user.email}\n💰 Solde : ${user.balance}$`, [
                { "title": "➕ Recharger", "payload": "ADD_FUNDS" },
                { "title": "📜 Mes Achats", "payload": "MY_ORDERS" }
            ]);

        case 'MY_ORDERS':
            const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
            if (orders.length === 0) return sendText(psid, "📦 Aucune commande trouvée.");
            let list = "📋 Vos 5 dernières commandes :\n";
            orders.forEach(o => list += `\n🔹 ID: ${o.orderId} | ${o.status}\n   ISP: ${o.provider} | Payé par: ${o.method}`);
            return sendText(psid, list);

        case 'ADD_FUNDS':
            user.step = 'AWAITING_BINANCE_ID'; await user.save();
            return sendText(psid, "💰 Recharger mon solde (Min 4$)\n\n1. USDT -> Binance ID: 1192024137\n2. Tapez votre ID Binance ici :");

        case 'START_ORDER':
            return sendButtons(psid, "🌍 Étape 1 : Pays", [{ "title": "🇺🇸 USA", "payload": "S_PROV" }]);

        case 'S_PROV':
            return sendButtons(psid, "📶 Étape 2 : Fournisseur (4$)", [
                { "title": "Verizon", "payload": "P_Verizon" },
                { "title": "T-Mobile", "payload": "P_TMobile" }
            ]);

        case payload.startsWith('P_') ? payload : null:
            const isp = payload.replace('P_', '');
            return sendButtons(psid, `💳 Proxy ${isp} (4$)\nMode de paiement :`, [
                { "title": `💰 Solde (${user.balance}$)`, "payload": `F_BAL_${isp}` },
                { "title": "🆔 Binance Pay", "payload": `F_BIN_${isp}` },
                { "title": "🚀 Litecoin (LTC)", "payload": `F_LTC_${isp}` }
            ]);

        case payload.startsWith('F_') ? payload : null:
            const parts = payload.split('_');
            const method = parts[1];
            const provider = parts[2];
            const oid = "PF" + Math.floor(Math.random()*900000);

            if (method === 'BAL') {
                if (user.balance >= 4) {
                    user.balance -= 4; await user.save();
                    await Order.create({ psid, orderId: oid, method: 'SOLDE', provider, status: 'LIVRÉ' });
                    return sendText(psid, `✅ Payé par solde ! Commande ${oid} validée. Votre nouveau solde : ${user.balance}$`);
                }
                return sendText(psid, "❌ Solde insuffisant. Rechargez votre compte.");
            }
            
            await Order.create({ psid, orderId: oid, method: method === 'BIN' ? 'BINANCE' : 'LTC', provider, status: 'EN ATTENTE' });
            if (method === 'BIN') {
                user.step = 'AWAITING_BINANCE_ID'; await user.save();
                return sendText(psid, `🛒 Commande ${oid}\n\nEnvoyez 4$ USDT vers Binance ID: 1192024137.\n\nTapez votre ID Binance ici.`);
            } else {
                return sendText(psid, `🛒 Commande ${oid}\n\nEnvoyez 4$ LTC vers: ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g\n\nContactez le support avec la preuve.`);
            }
    }
}

// --- FONCTIONS HELPERS ---
function sendAuthPrompt(psid) {
    sendButtons(psid, "ProxyFlow 🌐 | Bienvenue", [{ "title": "📝 S'inscrire", "payload": "GOTO_SIGNUP" }, { "title": "🔑 Connexion", "payload": "GOTO_LOGIN" }]);
}

function sendWelcomeMenu(psid, user) {
    sendButtons(psid, `Menu ProxyFlow 🌐 (Solde: ${user.balance}$)`, [
        { "title": "🛒 Acheter", "payload": "START_ORDER" },
        { "title": "👤 Mon Compte", "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) { callSendAPI(psid, { "text": text }); }

function sendButtons(psid, text, btns) {
    const buttons = btns.map(b => ({ "type": "postback", "title": b.title, "payload": b.payload }));
    callSendAPI(psid, { "attachment": { "type": "template", "payload": { "template_type": "button", "text": text, "buttons": buttons } } });
}

function callSendAPI(psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        recipient: { id: psid }, message: response
    }).catch(e => console.error("❌ Erreur API Facebook"));
}

app.listen(3000, () => console.log("🚀 ProxyFlow v4.3 - Prêt !"));
