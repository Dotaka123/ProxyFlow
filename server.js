const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// CONFIGURATION
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'proxyflow_secret_2026';

// 1. VERIFICATION DU WEBHOOK
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// 2. RECEPTION DES EVENEMENTS
app.post('/webhook', (req, res) => {
    let body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            let webhook_event = entry.messaging[0];
            let sender_psid = webhook_event.sender.id;

            if (webhook_event.message) {
                sendWelcomeMessage(sender_psid);
            } else if (webhook_event.postback) {
                handlePostback(sender_psid, webhook_event.postback.payload);
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 3. MESSAGE DE BIENVENUE
function sendWelcomeMessage(sender_psid) {
    const response = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": "Bienvenue chez ProxyFlow ! 🌐\n\nBesoin d'une connexion stable ? Nos proxys ISP sont à votre disposition.",
                "buttons": [
                    {
                        "type": "postback",
                        "title": "🛒 Acheter un proxy",
                        "payload": "START_ORDER"
                    },
                    {
                        "type": "postback",
                        "title": "ℹ️ À propos",
                        "payload": "ABOUT"
                    },
                    {
                        "type": "postback",
                        "title": "📞 Parler au support",
                        "payload": "SUPPORT"
                    }
                ]
            }
        }
    };
    callSendAPI(sender_psid, response);
}

// 4. LOGIQUE DES BOUTONS (POSTBACKS)
function handlePostback(sender_psid, payload) {
    let response;

    switch (payload) {
        case 'START_ORDER':
            // Choix du pays (USA uniquement)
            response = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "button",
                        "text": "🌍 Étape 1 : Choisissez le pays.\n(Actuellement : USA uniquement)",
                        "buttons": [
                            {
                                "type": "postback",
                                "title": "🇺🇸 USA",
                                "payload": "SELECT_USA"
                            }
                        ]
                    }
                }
            };
            break;

        case 'SELECT_USA':
            // Choix du Provider (Verizon ou T-Mobile)
            response = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "button",
                        "text": "📶 Étape 2 : Choisissez votre fournisseur ISP (4$).",
                        "buttons": [
                            {
                                "type": "postback",
                                "title": "Verizon",
                                "payload": "BUY_VERIZON"
                            },
                            {
                                "type": "postback",
                                "title": "T-Mobile",
                                "payload": "BUY_TMOBILE"
                            }
                        ]
                    }
                }
            };
            break;

        case 'BUY_VERIZON':
        case 'BUY_TMOBILE':
            const provider = (payload === 'BUY_VERIZON') ? "Verizon" : "T-Mobile";
            response = {
                "text": `✅ Commande : Proxy ISP USA - ${provider}\n💰 Prix : 4$\n\nVeuillez cliquer sur le lien ci-dessous pour payer et recevoir votre proxy instantanément :\n\n[LIEN_DE_PAIEMENT_ICI]`
            };
            break;

        case 'ABOUT':
            response = { "text": "ProxyFlow est spécialisé dans les proxys ISP (Verizon, T-Mobile). Nos adresses IP sont reconnues comme des connexions domestiques réelles, parfaites pour éviter les détections." };
            break;

        case 'SUPPORT':
            response = { "text": "💬 Posez votre question ici. Un agent de ProxyFlow vous répondra dans les plus brefs délais." };
            break;
    }
    
    callSendAPI(sender_psid, response);
}

// 5. ENVOI DES MESSAGES VERS FACEBOOK
function callSendAPI(sender_psid, response) {
    axios({
        method: 'POST',
        url: 'https://graph.facebook.com/v19.0/me/messages',
        params: { access_token: PAGE_ACCESS_TOKEN },
        data: {
            recipient: { id: sender_psid },
            message: response
        }
    }).catch(err => {
        console.error("Erreur API Facebook:", err.response ? err.response.data : err.message);
    });
}

// LANCEMENT DU SERVEUR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ProxyFlow est en ligne sur le port ${PORT}`));
