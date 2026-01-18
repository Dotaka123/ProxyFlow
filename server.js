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

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    isRegistered: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String,
    status: { type: String, default: 'EN_ATTENTE' },
    date: { type: Date, default: Date.now }
}));

// --- WEBHOOK ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
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

// --- GESTION DES MESSAGES ---
async function handleMessage(psid, text, user) {
    // Logique Auth (Email/Pass/Captcha)
    if (user.step === 'SIGNUP_EMAIL') { user.email = text; user.step = 'SIGNUP_PASS'; await user.save(); return sendText(psid, "🔐 Mot de passe :"); }
    if (user.step === 'SIGNUP_PASS') { 
        user.password = text; const n1 = Math.floor(Math.random()*10), n2 = Math.floor(Math.random()*10);
        user.captchaAnswer = n1 + n2; user.step = 'SIGNUP_CAPTCHA'; await user.save();
        return sendText(psid, `🤖 Captcha : Combien font ${n1} + ${n2} ?`);
    }
    if (user.step === 'SIGNUP_CAPTCHA') {
        if (parseInt(text) === user.captchaAnswer) { user.isRegistered = true; user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Erreur de calcul.");
    }

    // Login
    if (user.step === 'LOGIN_EMAIL') { user.email = text; user.step = 'LOGIN_PASS'; await user.save(); return sendText(psid, "🔑 Mot de passe :"); }
    if (user.step === 'LOGIN_PASS') {
        const acc = await User.findOne({ email: user.email, password: text });
        if (acc) { user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendWelcomeMenu(psid, user); }
        return sendText(psid, "❌ Incorrect.");
    }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);
    sendWelcomeMenu(psid, user);
}

// --- GESTION DES BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Email :"); }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);

    // DEBUT DU FLUX D'ACHAT
    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Étape 1 : Pays", [{ "title": "🇺🇸 USA", "payload": "STEP_PROV" }]);
    }

    if (payload === 'STEP_PROV') {
        return sendButtons(psid, "📶 Étape 2 : Fournisseur (4$)", [
            { "title": "Verizon", "payload": "PAY_METHOD_Verizon" },
            { "title": "T-Mobile", "payload": "PAY_METHOD_TMobile" }
        ]);
    }

    if (payload.startsWith('PAY_METHOD_')) {
        const provider = payload.replace('PAY_METHOD_', '');
        return sendButtons(psid, `💳 Proxy ${provider} (4$)\nChoisissez votre méthode de paiement :`, [
            { "title": "💰 Solde Local ($" + user.balance + ")", "payload": `FINAL_BAL_${provider}` },
            { "title": "🆔 Binance Pay", "payload": `FINAL_BIN_${provider}` },
            { "title": "🚀 Litecoin (LTC)", "payload": `FINAL_LTC_${provider}` }
        ]);
    }

    // TRAITEMENT FINAL DU PAIEMENT
    if (payload.startsWith('FINAL_')) {
        const parts = payload.split('_'); // [FINAL, METHOD, PROVIDER]
        const method = parts[1];
        const provider = parts[2];
        const orderID = "PF" + Math.floor(Math.random()*90000);

        if (method === 'BAL') {
            if (user.balance >= 4) {
                user.balance -= 4; await user.save();
                await Order.create({ psid, orderId: orderID, method: 'BALANCE', provider, status: 'LIVRÉ' });
                return sendText(psid, `✅ Achat réussi ! 4$ débités de votre solde.\nNuméro : ${orderID}\n🚀 Vos accès arrivent.`);
            } else {
                return sendText(psid, `❌ Solde insuffisant (${user.balance}$). Veuillez choisir une autre méthode.`);
            }
        }

        if (method === 'BIN') {
            await Order.create({ psid, orderId: orderID, method: 'BINANCE', provider });
            return sendText(psid, `🛒 Commande ${orderID} en attente.\n\nEnvoyez 4$ USDT vers Binance ID: 1192024137\n\nEnvoyez votre ID Binance ici pour valider.`);
        }

        if (method === 'LTC') {
            await Order.create({ psid, orderId: orderID, method: 'LTC', provider });
            return sendText(psid, `🛒 Commande ${orderID} en attente.\n\nEnvoyez 4$ LTC vers: ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g\n\nContactez le support avec la preuve.`);
        }
    }
}

// --- HELPERS ---
function sendAuthPrompt(psid) {
    sendButtons(psid, "ProxyFlow 🌐 | Identifiez-vous :", [{ "title": "📝 S'inscrire", "payload": "GOTO_SIGNUP" }, { "title": "🔑 Connexion", "payload": "GOTO_LOGIN" }]);
}
function sendWelcomeMenu(psid, user) {
    sendButtons(psid, `Menu ProxyFlow 🌐 (Solde: ${user.balance}$)`, [{ "title": "🛒 Acheter", "payload": "START_ORDER" }, { "title": "👤 Compte", "payload": "MY_ACCOUNT" }]);
}
function sendText(psid, text) { callSendAPI(psid, { "text": text }); }
function sendButtons(psid, text, btns) {
    const buttons = btns.map(b => ({ "type": "postback", "title": b.title, "payload": b.payload }));
    callSendAPI(psid, { "attachment": { "type": "template", "payload": { "template_type": "button", "text": text, "buttons": buttons } } });
}
function callSendAPI(sender_psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sender_psid }, message: response }).catch(e => {});
}

app.listen(3000, () => console.log("🚀 ProxyFlow v4.0 opérationnel !"));
