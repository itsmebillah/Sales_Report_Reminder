# Broadcast & Media Attachment Guide

⚡ **Architect:** Md. Masum Billah • [Website](https://itsmebillah.github.io/)

The **Broadcast Module** enables sending personalized announcements, operational updates, and file attachments to field personnel (TSOs, RSMs, Custom Contacts) via WhatsApp.

---

## 1. Broadcast Dashboard Interface

Open the **`Broadcast_Dashboard`** tab in Google Sheets:

| Section | Cell Range | Purpose |
|---|---|---|
| **Message Draft** | `H2:P17` | Compose text template with dynamic tags. |
| **Media Attachment Box** | **`H19:P19`** | Primary visible field for file paths or web links. |
| **Template Legend** | `H20:P21` | Supported variable placeholders. |
| **Recipient Table** | Columns `A:F` | List of target employees with checkboxes to select recipients. |

---

## 2. Using Media & File Attachments

Paste your attachment link or path directly into **`H19:P19`**:

### Supported Attachment Types:
1. **Local Windows File Paths:**
   - Example: `C:\Users\User\Desktop\Format.xlsx`
   - Example: `D:\Documents\SalesReport_Q3.pdf`
   - *Note:* Surrounding quotes (`"` or `'`) copied from Windows File Explorer are automatically cleaned.
2. **Google Drive Sharing Links:**
   - Example: `https://drive.google.com/file/d/1aB2c3D4e5F.../view?usp=sharing`
   - The system automatically resolves Google Drive files via direct binary streaming.
3. **Direct Public Web URLs:**
   - Example: `https://example.com/images/banner.png`
   - Example: `https://example.com/files/guidelines.pdf`

---

## 3. Dynamic Template Variables

You can include placeholders in your message draft (`H2:P17`) that are evaluated dynamically per recipient:

- **`{{name}}`**: Recipient's full name (e.g. *Md. Rahim Uddin*).
- **`{{designation}}`**: Employee designation (e.g. *TSO*, *RSM*, *AM*).
- **`{{id}}`**: Employee/territory ID (e.g. *TSO-104*).
- **`{{phone}}`**: Recipient phone number.

---

## 4. Sending Steps

1. Select recipient rows in `Broadcast_Dashboard` by ticking their **Select** checkbox.
2. Draft your message in `H2:P17`.
3. (Optional) Paste an attachment file path or URL into **`H19:P19`**.
4. Click **Sales Reminders** -> **Broadcast** -> **Queue Selected Broadcast Messages** from the spreadsheet menu.
5. The background `notification-sender` daemon will automatically detect the queued items and dispatch them sequentially.
