const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// Page d'accueil pour vérifier que le serveur tourne
app.get('/', (req, res) => res.send("Bot ProxyFlow Actif"));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connecté"))
    .catch(e => console.error("❌ Erreur MongoDB:", e));

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    language: { type: String, default: 'NONE' }, // 'NONE', 'fr', 'en', 'mg'
    step: { type: String, default: 'IDLE' },
    email: String, password: String, captchaCode: String,
    balance: { type: Number, default: 0 },
    selectedItem: String, selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, desc: String, price: Number, status: String
}));

// --- GESTION DES MESSAGES ---
async function handleMessage(psid, text, user) {
    if (user.language === 'NONE') return sendLanguagePicker(psid);
    const lang = user.language;

    // Réinitialisation si on tape "menu"
    if (text.toLowerCase() === "menu") {
        user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // -- INSCRIPTION --
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text;
        user.captchaCode = Math.floor(1000 + Math.random() * 9000).toString(); // Code simple 4 chiffres
        user.step = 'VERIFY_CAPTCHA'; await user.save();
        return sendText(psid, `Code CAPTCHA: ${user.captchaCode}`);
    }

    if (user.step === 'VERIFY_CAPTCHA') {
        if (text.trim() === user.captchaCode) {
            user.step = 'SIGNUP_PASS'; await user.save();
            return sendText(psid, (lang === 'mg' ? "Tenimiafina :" : "Mot de passe :"));
        }
        return sendText(psid, "Code Faux / Wrong Code");
    }

    if (user.step === 'SIGNUP_PASS') {
        user.password = text;
        user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    // -- QUANTITÉ --
    if (user.step === 'ASK_QTY') {
        const qty = parseInt(text);
        if (isNaN(qty)) return sendText(psid, "Erreur nombre.");
        
        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        
        // Boutons de confirmation simples
        return callAPI(psid, {
            attachment: { type: "template", payload: {
                template_type: "button",
                text: `Total: $${total}. Confirmer ?`,
                buttons: [
                    { type: "postback", title: "✅ OUI", payload: `PAY_YES_${qty}_${total}` },
                    { type: "postback", title: "❌ NON", payload: "MENU_SHOP" }
                ]
            }}
        });
    }

    // Par défaut
    sendMenu(psid, user);
}

// --- GESTION DES CLICS BOUTONS ---
async function handlePostback(psid, payload, user) {
    console.log(`Bouton cliqué: ${payload}`); // Pour le débogage

    // 1. Choix de langue (PRIORITAIRE)
    if (payload.startsWith('LANG_')) {
        user.language = payload.split('_')[1].toLowerCase();
        await user.save();
        return sendMenu(psid, user);
    }

    // Si pas de langue, on force le choix
    if (user.language === 'NONE') return sendLanguagePicker(psid);
    const lang = user.language;

    // 2. Navigation
    if (payload === 'GO_SIGNUP') {
        user.step = 'SIGNUP_EMAIL'; await user.save();
        return sendText(psid, "Email ?");
    }
    if (payload === 'GO_LOGIN') {
        // Version simplifiée pour test : on considère connecté direct
        return sendMenu(psid, user); 
    }

    if (payload === 'MENU_SHOP') {
        return callAPI(psid, {
            attachment: { type: "template", payload: {
                template_type: "button",
                text: "Choix / Choice :",
                buttons: [
                    { type: "postback", title: "Verizon ($4.5)", payload: "BUY_VERIZON_4.5" },
                    { type: "postback", title: "Virgin ($6)", payload: "BUY_VIRGIN_6" },
                    { type: "postback", title: "Static ($6)", payload: "BUY_STATIC_6" }
                ]
            }}
        });
    }

    if (payload.startsWith('BUY_')) {
        const parts = payload.split('_');
        user.selectedItem = parts[1];
        user.selectedPrice = parseFloat(parts[2]);
        user.step = 'ASK_QTY'; await user.save();
        return sendText(psid, (lang === 'mg' ? "Firy ?" : "Combien / Quantity ?"));
    }

    if (payload === 'MY_ACC') {
        return callAPI(psid, {
            attachment: { type: "template", payload: {
                template_type: "button",
                text: `Compte: ${user.email || 'Invite'}\nSolde: $${user.balance}`,
                buttons: [
                    { type: "web_url", title: "Support / Payer", url: SUPPORT_LINK },
                    { type: "postback", title: "Langue / Language", payload: "CHANGE_LANG" }
                ]
            }}
        });
    }

    if (payload === 'CHANGE_LANG') return sendLanguagePicker(psid);

    if (payload.startsWith('PAY_YES_')) {
        const parts = payload.split('_');
        const total = parts[3];
        // Création commande
        await Order.create({ psid, price: total, status: 'WAITING', desc: user.selectedItem });
        
        // Lien direct vers le support
        return callAPI(psid, {
            attachment: { type: "template", payload: {
                template_type: "button",
                text: `Commande créée ($${total}). Payer maintenant :`,
                buttons: [{ type: "web_url", title: "Contacter Support", url: SUPPORT_LINK }]
            }}
        });
    }
}

// --- FONCTIONS D'ENVOI (SIMPLIFIÉES) ---

function sendLanguagePicker(psid) {
    callAPI(psid, {
        attachment: { type: "template", payload: {
            template_type: "button",
            text: "Langue / Language :",
            buttons: [
                { type: "postback", title: "Français", payload: "LANG_FR" },
                { type: "postback", title: "English", payload: "LANG_EN" },
                { type: "postback", title: "Malagasy", payload: "LANG_MG" }
            ]
        }}
    });
}

function sendMenu(psid, user) {
    const lang = user.language;
    let txt = "Menu";
    let btnShop = "Shop";
    let btnAcc = "Account";

    if (lang === 'fr') { txt = "Menu Principal"; btnShop = "Boutique"; btnAcc = "Mon Compte"; }
    if (lang === 'mg') { txt = "Fandraisana"; btnShop = "Tsena"; btnAcc = "Kaonty"; }

    callAPI(psid, {
        attachment: { type: "template", payload: {
            template_type: "button",
            text: txt,
            buttons: [
                { type: "postback", title: btnShop, payload: "MENU_SHOP" },
                { type: "postback", title: btnAcc, payload: "MY_ACC" }
            ]
        }}
    });
}

function sendText(psid, text) {
    callAPI(psid, { text: text });
}

function callAPI(psid, messageContent) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        recipient: { id: psid },
        message: messageContent
    }).catch(error => {
        console.error("❌ ERREUR FACEBOOK:", error.response ? error.response.data : error.message);
    });
}

// --- WEBHOOK ---
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.send(req.query['hub.challenge']); });

app.post('/webhook', async (req, res) => {
    let entry = req.body.entry[0];
    if (entry && entry.messaging) {
        let event = entry.messaging[0];
        let psid = event.sender.id;
        
        // On récupère ou crée l'utilisateur
        let user = await User.findOne({ psid });
        if (!user) user = await User.create({ psid, language: 'NONE' });

        if (event.postback) {
            handlePostback(psid, event.postback.payload, user);
        } else if (event.message && event.message.text) {
            handleMessage(psid, event.message.text, user);
        }
    }
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000, () => console.log("Serveur démarré sur port 3000"));
