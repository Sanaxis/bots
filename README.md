# 🤖 Discord Topluluk ve Yönetim Botu

Bu bot; otomatik rol, Lost Nemo tarzı karşılama mesajı, interaktif butonlu kayıt, bildirim rolleri, seviye/XP sistemi ve destekçilere özel renk değiştirme özelliklerini içeren gelişmiş bir Discord.js v14 botudur.

---

## 🚀 Özellikler

1. **Oto-Rol & Lost Nemo Hoş Geldin Mesajı:**
   - Sunucuya katılan yeni üyeye anında **Kayıtsız Üye** rolü tanımlanır.
   - Hoş geldin kanalına üyenin avatarını, hesap kuruluş tarihini, sunucuya kaçıncı üye olarak katıldığını ve hızlı yönlendirme butonlarını içeren detaylı hoş geldin mesajı gönderilir.

2. **Kayıt Sistemi (`#kayıt-ol`):**
   - **Cinsiyet Seçimi:** [ 👨 Erkek ] / [ 👩 Kadın ] butonları.
   - **Oyun Tarzı:** [ ⚖️ Legal ] / [ 💀 İllegal ] / [ ⚡ Hem Legal & İllegal ] butonları.
   - Kullanıcı her iki seçimi tamamladığında:
     - Cinsiyet rolü ve oyun tarzı rolü verilir.
     - `config.json` içinde tanımlı kategori rolleri (`categoryAutoRoles`) otomatik verilir.
     - Kayıtlı Üye rolü verilir, Kayıtsız Üye rolü üzerlerinden alınır.

3. **Rol Alma Sistemi (`#rol-al`):**
   - 🔴 YouTube Bildirimleri, 🎉 Çekiliş Duyurusu, 🏆 Etkinlik Duyurusu, 📢 Genel Duyuru butonları.
   - **Aç/Kapa (Toggle):** Tıklanan rol kullanıcıda varsa kaldırılır, yoksa verilir.

4. **Seviye ve XP Sistemi (Metin + Ses):**
   - **Mesaj XP:** Atılan mesaj başına XP (dakikada 1 kez spam korumalı).
   - **Ses XP:** Ses kanalında geçirilen her dakika için XP.
   - **Otomatik Seviye Rolleri:** 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 seviye basamaklarında eski seviye rolü silinip yenisi verilir ve tebrik mesajı yayınlanır.
   - Komutlar: `/seviye` (Kişisel seviye kartı & ilerleme çubuğu), `/liderlik` (En aktif 10 üye sıralaması).

5. **Destekçi Avantajları & Renk Değiştirme (`#destekçi-avantajları`):**
   - Sadece Sunucu Destekçileri (Booster) veya yöneticiler kullanabilir.
   - **Renk Rolü Seçimi:** Menüden bir renk seçildiğinde kullanıcının **önceki tüm renk rolleri otomatik silinir** ve sadece yeni seçilen renk verilir.
   - **Kategori Rolü Seçimi:** Aynı mantıkla önceki kategori rolü kaldırılıp yenisi tanımlanır.
   - "Rolümü Kaldır" seçeneğiyle dilediğinde rengini veya kategorisini sıfırlayabilir.

---

## 🛠️ Kurulum Adımları

### 1. Discord Developer Portal Ayarları
1. [Discord Developer Portal](https://discord.com/developers/applications) adresine gidin.
2. Botunuzu seçin ve **Bot** sekmesine gelin.
3. **Privileged Gateway Intents** bölümünden aşağıdaki 3 yetkiyi MUTLAKA aktif edin:
   - ✅ **Presence Intent** (isteğe bağlı)
   - ✅ **Server Members Intent** (Zorunlu - Üye girişleri ve roller için)
   - ✅ **Message Content Intent** (Zorunlu - Mesaj XP takibi için)
4. Botunuzu sunucuya `Administrator` (Yönetici) yetkisiyle davet edin.

> ⚠️ **ÖNEMLİ (Rol Sıralaması):** Botunuzun rolü, Discord Sunucu Ayarları > Roller kısmında vereceği ve alacağı rollerin (Kayıtsız, Üye, Cinsiyet, Seviye, Renkler vb.) **üstünde** olmalıdır!

---

### 2. `config.json` Dosyasını Doldurma
[config.json](file:///C:/Users/Burak%20Turan/.gemini/antigravity-ide/scratch/discord-bot/config.json) dosyasını açarak kendi sunucunuzun ID'lerini girin:

```json
{
  "token": "BOTUNUZUN_TOKENI",
  "clientId": "BOTUNUZUN_APPLICATION_CLIENT_ID_SI",
  "guildId": "SUNUCUNUZUN_ID_SI",
  "channels": { ... },
  "roles": { ... }
}
```

---

### 3. Botu Başlatma
Terminal veya komut satırında bot klasörüne girip şu komutu çalıştırın:

```bash
node index.js
```

---

### 4. Panelleri Kanallara Gönderme (Slash Komutları)
Bot sunucunuzda aktif olduktan sonra yetkili bir hesapla ilgili kanallara gidin ve şu komutları yazın:

1. **#kayıt-ol** kanalında:
   ```
   /kurulum panel:Kayıt Ol Paneli (Cinsiyet + Oyun Tarzı)
   ```
2. **#rol-al** kanalında:
   ```
   /kurulum panel:Rol Alma Paneli (Bildirim & Duyuru)
   ```
3. **#destekçi-avantajları** kanalında:
   ```
   /kurulum panel:Destekçi Avantajları (Renk & Kategori)
   ```
