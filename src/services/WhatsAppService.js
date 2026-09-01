/**
 * @fileoverview WhatsAppService.js
 * @responsibility Connects to a generic WhatsApp API provider. Isolates HTTP requests
 * and error handling parameters.
 */

const WhatsAppService = (() => {
    /**
     * Sends a WhatsApp message using Meta WhatsApp Cloud API.
     * Reads PHONE_NUMBER_ID, ACCESS_TOKEN, META_API_VERSION, TEMPLATE_NAME, and TEMPLATE_LANGUAGE from Dashboard configuration.
     * Supports both template-based messages and text fallback messages.
     * Never throws uncaught exceptions.
     * @param {string|number} phoneNumber 
     * @param {string|Array} messageOrParams 
     * @returns {Object} { success: boolean, statusCode: number, responseText: string, errorMessage: string, isTestOverride: boolean, targetPhone: string }
     */
    /**
     * Sanitizes template parameters to comply with Meta WhatsApp Cloud API rule (#132018):
     * Param text cannot have new-line/tab characters or more than 4 consecutive spaces.
     * Replaces line breaks and bullets with clean comma separators.
     * @param {any} input 
     * @returns {string} Sanitized string parameter
     */
    const sanitizeTemplateParameter = (input) => {
        if (input === undefined || input === null) return '';
        let str = String(input);
        // Remove bullet characters (• / \u2022)
        str = str.replace(/[•\u2022]/g, '');
        // Remove tab characters
        str = str.replace(/\t/g, '');
        // Replace CRLF (\r\n), CR (\r), LF (\n) with ", "
        str = str.replace(/\r\n/g, ', ');
        str = str.replace(/\r/g, ', ');
        str = str.replace(/\n/g, ', ');
        // Replace pipe symbol if present with ", "
        str = str.replace(/\|/g, ', ');
        // Collapse multiple commas and spaces like ", , " -> ", "
        str = str.replace(/(,\s*)+/g, ', ');
        // Collapse multiple consecutive spaces into a single space
        str = str.replace(/ {2,}/g, ' ');
        // Trim leading/trailing whitespace and commas
        return str.trim().replace(/^,\s*|\s*,$/g, '');
    };

    const send = (phoneNumber, messageOrParams) => {
        try {
            const config = ConfigLoader.load();
            const phoneNumberId = config['PHONE_NUMBER_ID'] || config['WhatsApp_Phone_Number_ID'] || '';
            const accessToken = config['ACCESS_TOKEN'] || config['WhatsApp_API_Token'] || '';
            const apiVersion = config['META_API_VERSION'] || 'v25.0';
            const templateName = config['TEMPLATE_NAME'] || '';
            const templateLanguage = config['TEMPLATE_LANGUAGE'] || 'en_US';

            // Testing Override Evaluation
            const isTestMode = String(config['TEST_MODE']).toUpperCase() === 'TRUE' || String(config['SENDER_MODE']).toUpperCase() === 'TEST';
            const overridePhone = String(config['TEST_RECIPIENT_PHONE'] || config['OVERRIDE_PHONE'] || '').trim();
            const isOverridden = Boolean(isTestMode && overridePhone !== '');

            // Destination phone selection (Override recipient if TEST_MODE is active and OVERRIDE_PHONE/TEST_RECIPIENT_PHONE is present)
            const targetDestinationPhone = isOverridden ? overridePhone : phoneNumber;

            if (!phoneNumberId || String(phoneNumberId).trim() === '') {
                return {
                    success: false,
                    statusCode: 400,
                    responseText: '',
                    errorMessage: "PHONE_NUMBER_ID is missing or blank in Dashboard configuration.",
                    isTestOverride: isOverridden,
                    targetPhone: targetDestinationPhone
                };
            }

            if (!accessToken || String(accessToken).trim() === '') {
                return {
                    success: false,
                    statusCode: 401,
                    responseText: '',
                    errorMessage: "ACCESS_TOKEN is missing or blank in Dashboard configuration.",
                    isTestOverride: isOverridden,
                    targetPhone: targetDestinationPhone
                };
            }

            // Sanitize target recipient phone number for Meta Cloud API (digits only)
            let recipientPhone = String(targetDestinationPhone).replace(/\D/g, '');
            if (recipientPhone.startsWith('0')) {
                recipientPhone = '880' + recipientPhone.substring(1);
            } else if (recipientPhone.length === 10 && recipientPhone.startsWith('1')) {
                recipientPhone = '880' + recipientPhone;
            }

            const endpointUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

            let payloadObj;
            let bodyParameters = [];
            let fallbackBodyText = "";

            if (Array.isArray(messageOrParams)) {
                bodyParameters = messageOrParams.map(param => ({
                    type: "text",
                    text: sanitizeTemplateParameter(param)
                }));
                const tsoName = messageOrParams[0] || '';
                const dateStr = messageOrParams[1] || '';
                const countStr = messageOrParams[2] || '';
                const srListStr = messageOrParams[3] || '';
                const tz = config['Timezone'] || 'Asia/Dhaka';
                const nextDayDate = typeof DateUtils !== 'undefined' && DateUtils.getNextDayDate
                    ? DateUtils.getNextDayDate(new Date(), tz)
                    : new Date(Date.now() + 86400000);
                const formattedNextDayDate = typeof DateUtils !== 'undefined' && DateUtils.formatDate
                    ? DateUtils.formatDate(nextDayDate, tz)
                    : Utilities.formatDate(nextDayDate, tz, "dd-MMM-yyyy");
                const withDeadlineText = `${formattedNextDayDate} 10.00 থেকে সকাল 11.00 টা`;

                const todayDate = new Date();
                const formattedTodayDate = typeof DateUtils !== 'undefined' && DateUtils.formatDate
                    ? DateUtils.formatDate(todayDate, tz)
                    : Utilities.formatDate(todayDate, tz, "dd-MMM-yyyy");
                const standardDeadlineText = `আজ (${formattedTodayDate}) সকাল 10.00 থেকে 11.00 টা`;

                const messageDraft = String(config['MESSAGE_DRAFT'] || config['REMINDER_MESSAGE_DRAFT'] || 'WITH_DEADLINE').toUpperCase().trim();
                const isDraft2 = messageDraft === 'STANDARD' || messageDraft === 'DRAFT_2' || messageDraft === 'DRAFT 2';
                if (isDraft2) {
                    fallbackBodyText = `আসসালামু আলাইকুম।\n\nপ্রিয় ${tsoName},\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: ${dateStr}\n⏰ পোস্টিংয়ের শেষ সময়: ${standardDeadlineText}\n\n📌 মোট বাকি এসআর: ${countStr} জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n${srListStr}\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসআর ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।`;
                } else {
                    fallbackBodyText = `আসসালামু আলাইকুম।\n\nপ্রিয় ${tsoName},\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: *${dateStr}*\n⏰ পোস্টিংয়ের শেষ সময়: *${withDeadlineText}*\n\n📌 মোট বাকি এসআর: ${countStr} জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n${srListStr}\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসআর ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।`;
                }
            } else {
                const msgStr = String(messageOrParams || '');
                bodyParameters = [{ type: "text", text: sanitizeTemplateParameter(msgStr) }];
                fallbackBodyText = msgStr;
            }

            if (templateName && String(templateName).trim() !== '') {
                payloadObj = {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: recipientPhone,
                    type: "template",
                    template: {
                        name: String(templateName).trim(),
                        language: {
                            code: String(templateLanguage).trim()
                        },
                        components: [
                            {
                                type: "body",
                                parameters: bodyParameters
                            }
                        ]
                    }
                };
            } else {
                payloadObj = {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: recipientPhone,
                    type: "text",
                    text: {
                        preview_url: false,
                        body: fallbackBodyText
                    }
                };
            }

            // TASK 1: Log the ENTIRE actual payload object
            Logger.log("==================================================");
            Logger.log("ACTUAL OUTGOING PAYLOAD OBJECT (JSON.stringify)");
            Logger.log("==================================================");
            Logger.log(JSON.stringify(payloadObj, null, 2));

            // TASK 2 & 3 & 4: Log each parameter separately, its hex codes, and check for invalid chars
            Logger.log("==================================================");
            Logger.log("PARAMETER SANITIZATION & HEX CODE AUDIT");
            Logger.log("==================================================");
            bodyParameters.forEach((p, idx) => {
                const pJson = JSON.stringify(p);
                Logger.log(`Parameter ${idx + 1}: ${pJson}`);
                
                const textVal = p.text || '';
                const hexCodes = Array.from(textVal).map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join(' ');
                Logger.log(`Parameter ${idx + 1} Hex Codes: ${hexCodes}`);

                if (/[\r\n\t]/.test(textVal)) {
                    Logger.log(`WARNING: Parameter ${idx + 1} STILL CONTAINS CONTROL CHARACTERS (CR/LF/TAB)!`);
                }
                if (/ {2,}/.test(textVal)) {
                    Logger.log(`WARNING: Parameter ${idx + 1} STILL CONTAINS MULTIPLE CONSECUTIVE SPACES!`);
                }
            });

            const options = {
                method: 'post',
                contentType: 'application/json',
                muteHttpExceptions: true,
                headers: {
                    'Authorization': `Bearer ${accessToken.trim()}`
                },
                payload: JSON.stringify(payloadObj)
            };

            const response = UrlFetchApp.fetch(endpointUrl, options);
            const code = response.getResponseCode();
            const resultText = response.getContentText();

            // TASK 6: Log HTTP Status and Complete JSON Response
            Logger.log("==================================================");
            Logger.log("META GRAPH API HTTP RESPONSE");
            Logger.log("==================================================");
            Logger.log("HTTP Status: " + code);
            Logger.log("Response Body:\n" + resultText);
            try {
                const parsedRes = JSON.parse(resultText);
                if (parsedRes.error && parsedRes.error.fbtrace_id) {
                    Logger.log("fbtrace_id: " + parsedRes.error.fbtrace_id);
                }
            } catch (pErr) {}

            if (code >= 200 && code < 300) {
                return {
                    success: true,
                    statusCode: code,
                    responseText: resultText,
                    errorMessage: '',
                    isTestOverride: isOverridden,
                    targetPhone: recipientPhone
                };
            } else {
                return {
                    success: false,
                    statusCode: code,
                    responseText: resultText,
                    errorMessage: `Meta API Error (${code}): ${resultText}`,
                    isTestOverride: isOverridden,
                    targetPhone: recipientPhone
                };
            }
        } catch (err) {
            return {
                success: false,
                statusCode: 500,
                responseText: '',
                errorMessage: `Meta API Exception: ${String(err)}`,
                isTestOverride: typeof isOverridden !== 'undefined' ? isOverridden : false,
                targetPhone: typeof recipientPhone !== 'undefined' ? recipientPhone : ''
            };
        }
    };

    return { send };
})();
