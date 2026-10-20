const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder
} = require('discord.js');

const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

const fs = require('node:fs');
const path = require('node:path');
const db = require('./database.js');
// Config dosyasını yükle
const configPath = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Render ortam değişkeninden Discord token'ını al
config.token = process.env.DISCORD_TOKEN || config.token;

// Discord Client kurulumu
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
});

// Seste durma sürelerini takip etmek için map: userId -> joinTimestamp
const voiceJoinMap = new Map();
// Mesaj XP cooldown map: userId -> timestamp
const messageCooldownMap = new Map();
// Yetkili başvuru taslakları (Adım 1, 2, 3) map: userId -> draftData
const staffAppDrafts = new Map();

// Seviye Eşikleri ve Hesaplama
function calculateLevel(xp) {
  if (xp <= 0) return 0;
  return Math.floor(Math.sqrt(xp / 50));
}

function xpForLevel(level) {
  return 50 * Math.pow(level, 2);
}

function formatVoiceTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} saat ${minutes} dk`;
  }
  return `${minutes} dakika`;
}

function createProgressBar(current, target, length = 12) {
  if (target <= 0) return '`[████████████]` 100%';
  const progress = Math.min(Math.max(current / target, 0), 1);
  const filled = Math.round(length * progress);
  const empty = length - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = Math.round(progress * 100);
  return `\`[${bar}]\` %${percent}`;
}

// Ortak Seviye Kartı Embed Üretici (Samimi & Gamer Tasarım)
function buildRankEmbed(targetUser, guild) {
  const userData = db.getUser(targetUser.id);
  const currentLvl = calculateLevel(userData.xp);
  const currentLvlBaseXp = xpForLevel(currentLvl);
  const nextLvlXp = xpForLevel(currentLvl + 1);
  const xpInCurrentLvl = Math.max(0, userData.xp - currentLvlBaseXp);
  const xpNeededForNext = nextLvlXp - currentLvlBaseXp;
  const progressBar = createProgressBar(xpInCurrentLvl, xpNeededForNext);

  return new EmbedBuilder()
    .setColor(0x00d26a)
    .setAuthor({ name: `${targetUser.username} • Seviye & Profil Kartı`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
    .setDescription(
      `<:seviye:1537945016805359706> **Mevcut Seviye:** \`Seviye ${currentLvl}\`\n` +
      `<:deneyim:1561129407865954454> **Toplam Deneyim:** \`${userData.xp.toLocaleString()} XP\`\n\n` +
      `<:ilerleme:1561137822528704532> **Seviye ${currentLvl + 1} İlerlemesi:**\n` +
      `${progressBar} *(${xpInCurrentLvl.toLocaleString()} / ${xpNeededForNext.toLocaleString()} XP)*\n\n` +
      `💬 **Sohbet:** \`${userData.messages.toLocaleString()}\` mesaj\n` +
      `🎙️ **Ses Vakti:** \`${formatVoiceTime(userData.voice_seconds)}\``
    )
    .setFooter({ text: `${guild.name} • Aktif kalıp seviye atlamaya devam et!` })
    .setTimestamp();
}

// Ortak Liderlik Tablosu Embed Üretici
function buildLeaderboardEmbed(guild, limit = 10) {
  const topUsers = db.getTopUsers(limit);

  if (!topUsers || topUsers.length === 0) {
    return new EmbedBuilder()
      .setColor(0xffb703)
      .setTitle(`<:top123:1561866314828611646> ${guild.name} • En Aktifler Sıralaması`)
      .setDescription('Henüz sıralamaya girecek kadar puan kasan biri çıkmadı. İlk sen ol!');
  }

  let desc = 'Sunucunun en aktif üyeleri burada! Sohbet edip ses kanallarında takılarak zirveye oynayabilirsin.\n\n';
  const medals = [
    '<:top1:1561867095744979087>',
    '<:top2:1561866337373134919>',
    '<:top3:1561866313285111868>',
    '<:top4:1561866344281145344>',
    '<:top5:1561866333866430494>',
    '<:top6:1561866346818699296>',
    '<:top7:1561866339533201488>',
    '<:top8:1561866317701587015>',
    '<:top9:1561866311368187976>',
    '<:top10:1561866341936402462>'
  ];

  for (let i = 0; i < 10; i++) {
    const medal = medals[i] || `**#${i + 1}**`;
    const user = topUsers[i];
    if (user) {
      const lvl = calculateLevel(user.xp);
      desc += `${medal} <@${user.user_id}> • **Seviye ${lvl}** (\`${user.xp.toLocaleString()} XP\`)\n` +
              `   ┗ 💬 \`${user.messages} mesaj\` • 🎙️ \`${formatVoiceTime(user.voice_seconds)}\`\n\n`;
    } else {
      desc += `${medal} *Henüz kimse yok* • **Seviye 0** (\`0 XP\`)\n` +
              `   ┗ 💬 \`0 mesaj\` • 🎙️ \`0s\`\n\n`;
    }
  }

  return new EmbedBuilder()
    .setColor(0xffb703)
    .setTitle(`<:top123:1561866314828611646> ${guild.name} • En Aktifler Sıralaması`)
    .setDescription(desc)
    .setFooter({ text: 'Sen de sohbete katılıp listede yerini al!' })
    .setTimestamp();
}

// ==========================================
// PANELLERİ OLUŞTURUCU YARDIMCI FONKSİYONLAR
// ==========================================

// 1. KAYIT PANELİ (Buton Akışlı)
function getRegisterPanelPayload(guild) {
  const regEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('<:kalp:1561130373167980605> SUNUCU KAYIT ALANI')
    .setDescription(
      `Selam! Sunucunun tüm kanallarını açmak ve ortamımıza katılmak için kaydını yapman gerekiyor.\n\n` +
      `<:gttrwarn:1537943562111680623> **Nasıl Kayıt Olurum?**\n` +
      `Aşağıdaki **Kayıt Ol** butonuna tıkla, açılan pencerede Cinsiyetini ve Oyun Tarzını gir.\n\n` +
      `<:etiket:1561151811585446081> Formu gönderdiğin an kayıtsız rolün kalkacak ve aramıza resmen katılmış olacaksın!`
    )
    .setFooter({ text: `${guild ? guild.name : 'Sunucu'} • Kayıt Sistemi` });

  const regRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_open_reg_modal')
      .setLabel('Kayıt Ol')
      .setEmoji('1561556279225225236')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [regEmbed], components: [regRow] };
}

// 2. ÖNERİ PANELİ
function getSuggestionPanelPayload(guild) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('<:oner:1561859540935376957> Öneri Sistemi')
    .setDescription(
      `Growtopia Türkiye'yi birlikte daha iyi bir topluluk hâline getirelim! Sunucumuzla ilgili fikirlerini, geliştirme önerilerini ve eklenmesini istediğin özellikleri bizimle paylaşabilirsin. Önerin yetkili ekibimiz tarafından değerlendirilecek ve topluluğumuzun gelişmesine katkıda bulunacaktır.\n\n` +
      `<:gttrright:1537943550069706792> Unutma: Önerilerini açık, anlaşılır ve saygılı bir şekilde ilet. Her fikir bizim için değerlidir!`
    )
    .setFooter({ text: `${guild ? guild.name : 'Sunucu'} • Öneri Sistemi` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_suggest')
      .setLabel('Öneri Gönder')
      .setEmoji('1561860075650289685')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

// 3. ROL ALMA PANELİ (Oyun Tarzı & Duyuru / Video / Anons)
function getRolesPanelPayload(guild) {
  const roleEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('<:Growpedia:1561556279225225236> ROL SEÇİM PANELİ')
    .setDescription(
      `Growtopia Türkiye'deki deneyimini özelleştir! Buradan oyun tarzını değiştirebilir ve kaçırmak istemediğin duyuruların bildirim rollerini dilediğin gibi açıp kapatabilirsin.\n\n` +
      `<:agac:1558168928402800751> **Oyun Tarzı Rolleri:**\n` +
      `<:gttrright:1537943550069706792> **Legal:** Ticaretini ve oyununu kurallara uygun sürdüren oyuncular.\n` +
      `<:gttrright:1537943550069706792> **İllegal:** Casino, rulet ve riskli dünyalarda takılan oyuncular.\n\n` +
      `<:gttrmega:1537945029715169340> **Bildirim & Duyuru Rolleri:**\n` +
      `<:gttrright:1537943550069706792> **Video / Yayın:** Yeni YouTube videoları ve canlı yayın bildirimleri.\n` +
      `<:gttrright:1537943550069706792> **Çekiliş Duyurusu:** Büyük ödüllü elmas ve eşya çekilişleri.\n` +
      `<:gttrright:1537943550069706792> **Etkinlik:** Özel etkinlikler, turnuvalar ve yarışmalar.\n\n` +
      `<:gttrwarn:1537943562111680623> *Almak veya çıkarmak istediğin rolün butonuna tıklaman yeterlidir. Seçimi kaldırmak için aynı butona tekrar tıkla.*`
    )
    .setFooter({ text: `${guild ? guild.name : 'Sunucu'} • Rol Yönetim Paneli` });

  const playstyleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_role_legal')
      .setLabel('Legal Oyuncu')
      .setEmoji('1561854294251020419')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_role_illegal')
      .setLabel('İllegal Oyuncu')
      .setEmoji('1561853989790818304')
      .setStyle(ButtonStyle.Secondary)
  );

  const notifRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_role_youtube')
      .setLabel('Video / Yayın')
      .setEmoji('1537945029715169340')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_role_giveaway')
      .setLabel('Çekilişler')
      .setEmoji('1537945029715169340')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_role_event')
      .setLabel('Etkinlik')
      .setEmoji('1537945029715169340')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [roleEmbed], components: [playstyleRow, notifRow] };
}

// 3. DESTEKÇİ AVANTAJLARI PANELİ (11 Renk + 5 Koleksiyon Rolü)
function getSupporterPanelPayload(guild) {
  // Renk listesi önizlemesi (Discord role mention olarak tam renkli rozet görünür)
  const colorListText = (config.roles.colors || []).map(c => {
    if (c.id && !c.id.includes('_ROL_ID')) {
      return `• <@&${c.id}>`;
    }
    return `• ${c.label}`;
  }).join('\n');

  // 5 Koleksiyon Rolü Önizlemesi (Doğru emojilerle)
  const titleListText = [
    `# 1. <:gttrright:1537943550069706792> <:wing:1561134448559390790>`,
    `# 2. <:gttrright:1537943550069706792> <:turkey:1558147651520692254>`,
    `# 3. <:gttrright:1537943550069706792> <:legendt:1558147601570988145>`,
    `# 4. <:gttrright:1537943550069706792> <:g4g:1558147501322797207>`,
    `# 5. <:gttrright:1537943550069706792> <:mentor:1558147548273844286>`
  ].join('\n');

  // Sunucudaki emojiyi otomatik bul (animasyonlu veya statik)
  const cachedEmoji = guild?.emojis?.cache?.get('1561127951796277418');
  const emojiStr = cachedEmoji ? cachedEmoji.toString() : '<a:takviye:1561127951796277418>';

  const supporterEmbed = new EmbedBuilder()
    .setColor(0xf47fff)
    .setDescription(
      `# ${emojiStr} TAKVİYE AYRICALIKLARI\n\n` +
      `Sunucumuza takviye basıp destek olanlar için özel hazırlanan menüye hoş geldin!\n\n` +
      `**Renk Rolleri:**\n` +
      `${colorListText}\n\n` +
      `**Koleksiyon:**\n` +
      `${titleListText}\n\n` +
      `> Aşağıdaki menülerden dilediğin rengi ve ünvanı seçebilirsin. Yeni bir seçim yaptığında önceki rolün otomatik olarak temizlenir.`
    )
    .setFooter({ text: `${guild ? guild.name : 'Sunucu'} • Takviye Paneli` });

  // Renk seçenekleri (Yazıdan önce emoji olmadan, sadece isim)
  const colorOptions = (config.roles.colors || []).map(color =>
    new StringSelectMenuOptionBuilder()
      .setLabel(color.label)
      .setValue(`color_${color.id}`)
  );
  colorOptions.unshift(
    new StringSelectMenuOptionBuilder()
      .setLabel('ㅤㅤㅤㅤㅤㅤROLÜMÜ KALDIR')
      .setValue('color_remove')
  );

  const colorMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu_supporter_color')
      .setPlaceholder('İsminin rengini seç...')
      .addOptions(colorOptions)
  );

  // Koleksiyon seçenekleri (Sadece rolün fotosu/emojisi gözükür, yazı yazmaz)
  const categoryOptions = (config.roles.supporterCategories || []).map(cat => {
    return new StringSelectMenuOptionBuilder()
      .setLabel('ㅤ') // Görünmez karakter, yazı yazmaz
      .setValue(`cat_${cat.id}`)
      .setEmoji(cat.emoji);
  });

  categoryOptions.unshift(
    new StringSelectMenuOptionBuilder()
      .setLabel('ㅤㅤㅤㅤㅤㅤROLÜMÜ KALDIR')
      .setValue('cat_remove')
  );

  const categoryMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu_supporter_category')
      .setPlaceholder('Koleksiyon rolünü seç...')
      .addOptions(categoryOptions)
  );

  return { embeds: [supporterEmbed], components: [colorMenu, categoryMenu] };
}

// 4. YETKİLİ BAŞVURU PANELİ
function getStaffAppPanelPayload(guild) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('<:Growpedia:1561556279225225236> YETKİLİ BAŞVURU FORMU')
    .setDescription(
      `Growtopia Türkiye ailemize katılmak, sunucu düzenini sağlamak ve topluluğumuzu daha ileriye taşımak ister misin?\n\n` +
      `<:gttrright:1537943550069706792> **Kimler Başvurabilir?**\n` +
      `• Sunucu kurallarına hâkim ve tarafsız davranabilen,\n` +
      `• İletişim becerisi yüksek, olgun ve sorumluluk sahibi,\n` +
      `• Günlük aktiflik gösterebilecek üyelerimiz başvurabilir.\n\n` +
      `<:gttrright:1537943550069706792> **Nasıl Başvururum?**\n` +
      `Aşağıdaki **Başvuru Yap** butonuna tıkla, açılan adımlardaki soruları samimi ve eksiksiz bir şekilde doldur.\n\n` +
      `<:gttrwarn:1537943562111680623> *Yalan veya eksik bilgi vermek başvurunuzun doğrudan reddedilmesine sebep olur.*`
    )
    .setFooter({ text: `${guild ? guild.name : 'Sunucu'} • Yetkili Alımları` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_staff_apply')
      .setLabel('Başvuru Yap')
      .setEmoji('1561860075650289685')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

// 5. YETKİLİ ŞİKAYET PANELİ
function getStaffComplaintPanelPayload(guild) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('<:Growpedia:1561556279225225236> YETKİLİ ŞİKAYET TALEBİ')
    .setDescription(
      `Yetkili ekibimizden birinin kuralları ihlal ettiğini, yetkisini kötüye kullandığını veya haksız bir tutum sergilediğini düşünüyorsan buradan resmi şikayet talebi açabilirsin.\n\n` +
      `<:gttrright:1537943550069706792> **Nasıl Çalışır?**\n` +
      `Aşağıdaki **Şikayet Talebi Aç** butonuna bastığında sana ve üst yönetime özel gizli bir şikayet kanalı açılır.\n\n` +
      `<:gttrright:1537943550069706792> **Gerekli Bilgiler:**\n` +
      `Açılan kanala şikayetçi olduğun yetkilinin adını/etiketini, olayın detaylarını ve kanıtlarını (ekran görüntüsü, mesaj bağlantısı vb.) iletmen gerekir.\n\n` +
      `<:gttrwarn:1537943562111680623> **Önemli:** Talepler yalnızca üst yönetim (Kurucu / Yetkili Sorumlusu) tarafından incelenir ve kesinlikle gizli tutulur. Asılsız ve troll şikayetler cezalandırılır.`
    )
    .setFooter({ text: `${guild ? guild.name : 'Sunucu'} • Şikayet Sistemi` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_staff_complaint_open')
      .setLabel('Şikayet Talebi Aç')
      .setEmoji('1537945028045836298')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

// ==========================================
// OTOMATİK KANAL PANEL KONTROLÜ
// ==========================================
async function checkAndSendPanels() {
  console.log('🔍 Kanallardaki paneller kontrol ediliyor...');

  // 1. Kayıt Ol Kanalı
  if (config.channels.register) {
    try {
      const channel = await client.channels.fetch(config.channels.register).catch(() => null);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
        const existingRegisterMsg = messages && messages.find(m =>
          m.author.id === client.user.id &&
          m.components.some(row => row.components.some(c => c.customId === 'btn_open_reg_modal' || c.customId === 'btn_reg_gender_male'))
        );
        const payload = getRegisterPanelPayload(channel.guild);
        if (!existingRegisterMsg) {
          console.log(`📤 Kayıt paneli bulunamadı, #${channel.name} kanalına gönderiliyor...`);
          await channel.send(payload);
          console.log(`✅ Kayıt paneli #${channel.name} kanalına başarıyla gönderildi.`);
        } else {
          await existingRegisterMsg.edit(payload).catch(() => {});
          console.log(`✔️ Kayıt paneli #${channel.name} kanalında güncellendi.`);
        }
      }
    } catch (e) {
      console.error('Kayıt paneli kontrol hatası:', e.message);
    }
  }

  // 2. Rol Alma Kanalı
  if (config.channels.roleSelect) {
    try {
      const channel = await client.channels.fetch(config.channels.roleSelect).catch(() => null);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
        const existingRolesMsg = messages && messages.find(m =>
          m.author.id === client.user.id &&
          m.components.some(row => row.components.some(c => c.customId === 'btn_role_youtube'))
        );
        const payload = getRolesPanelPayload(channel.guild);
        if (!existingRolesMsg) {
          console.log(`📤 Rol alma paneli bulunamadı, #${channel.name} kanalına gönderiliyor...`);
          await channel.send(payload);
          console.log(`✅ Rol alma paneli #${channel.name} kanalına başarıyla gönderildi.`);
        } else {
          await existingRolesMsg.edit(payload).catch(() => {});
          console.log(`✔️ Rol alma paneli #${channel.name} kanalında güncellendi.`);
        }
      }
    } catch (e) {
      console.error('Rol alma paneli kontrol hatası:', e.message);
    }
  }

  // 3. Destekçi Avantajları Kanalı
  if (config.channels.supporter) {
    try {
      const channel = await client.channels.fetch(config.channels.supporter).catch(() => null);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
        const existingSupporterMsg = messages && messages.find(m =>
          m.author.id === client.user.id &&
          m.components.some(row => row.components.some(c => c.customId === 'menu_supporter_color'))
        );
        const payload = getSupporterPanelPayload(channel.guild);
        if (!existingSupporterMsg) {
          console.log(`📤 Destekçi paneli bulunamadı, #${channel.name} kanalına gönderiliyor...`);
          await channel.send(payload);
          console.log(`✅ Destekçi paneli #${channel.name} kanalına başarıyla gönderildi.`);
        } else {
          await existingSupporterMsg.edit(payload).catch(() => {});
          console.log(`✔️ Destekçi paneli #${channel.name} kanalında yeni renk önizlemeleriyle güncellendi.`);
        }
      }
    } catch (e) {
      console.error('Destekçi paneli kontrol hatası:', e.message);
    }
  }

  // 4. Öneri Kanalı (Panelin durduğu kanal)
  const suggestionPanelId = config.channels.suggestionPanel || config.channels.suggestion;
  if (suggestionPanelId) {
    try {
      const channel = await client.channels.fetch(suggestionPanelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
        const existingSuggestionMsg = messages && messages.find(m =>
          m.author.id === client.user.id &&
          m.components.some(row => row.components.some(c => c.customId === 'btn_suggest'))
        );
        const payload = getSuggestionPanelPayload(channel.guild);
        if (!existingSuggestionMsg) {
          console.log(`📤 Öneri paneli bulunamadı, #${channel.name} kanalına gönderiliyor...`);
          await channel.send(payload);
          console.log(`✅ Öneri paneli #${channel.name} kanalına başarıyla gönderildi.`);
        } else {
          await existingSuggestionMsg.edit(payload).catch(() => {});
          console.log(`✔️ Öneri paneli #${channel.name} kanalında güncellendi.`);
        }
      }
    } catch (e) {
      console.error('Öneri paneli kontrol hatası:', e.message);
    }
  }

  // 5. Yetkili Başvuru Kanalı
  if (config.channels.staffAppPanel) {
    try {
      const channel = await client.channels.fetch(config.channels.staffAppPanel).catch(() => null);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
        const existingAppMsg = messages && messages.find(m =>
          m.author.id === client.user.id &&
          m.components.some(row => row.components.some(c => c.customId === 'btn_staff_apply'))
        );
        const payload = getStaffAppPanelPayload(channel.guild);
        if (!existingAppMsg) {
          console.log(`📤 Yetkili başvuru paneli bulunamadı, #${channel.name} kanalına gönderiliyor...`);
          await channel.send(payload);
          console.log(`✅ Yetkili başvuru paneli #${channel.name} kanalına başarıyla gönderildi.`);
        } else {
          await existingAppMsg.edit(payload).catch(() => {});
          console.log(`✔️ Yetkili başvuru paneli #${channel.name} kanalında güncellendi.`);
        }
      }
    } catch (e) {
      console.error('Yetkili başvuru paneli kontrol hatası:', e.message);
    }
  }

  // 6. Yetkili Şikayet Kanalı
  if (config.channels.staffComplaintPanel) {
    try {
      const channel = await client.channels.fetch(config.channels.staffComplaintPanel).catch(() => null);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
        const existingComplaintMsg = messages && messages.find(m =>
          m.author.id === client.user.id &&
          m.components.some(row => row.components.some(c => c.customId === 'btn_staff_complaint_open'))
        );
        const payload = getStaffComplaintPanelPayload(channel.guild);
        if (!existingComplaintMsg) {
          console.log(`📤 Yetkili şikayet paneli bulunamadı, #${channel.name} kanalına gönderiliyor...`);
          await channel.send(payload);
          console.log(`✅ Yetkili şikayet paneli #${channel.name} kanalına başarıyla gönderildi.`);
        } else {
          await existingComplaintMsg.edit(payload).catch(() => {});
          console.log(`✔️ Yetkili şikayet paneli #${channel.name} kanalında güncellendi.`);
        }
      }
    } catch (e) {
      console.error('Yetkili şikayet paneli kontrol hatası:', e.message);
    }
  }
}

// ==========================================
// 1. BOT HAZIR OLDUĞUNDA VE SLASH KOMUTLARI
// ==========================================
client.once('clientReady', async () => {
  console.log(`========================================`);
  console.log(`🤖 Bot Aktif: ${client.user.tag}`);
  console.log(`🌐 Sunucu Sayısı: ${client.guilds.cache.size}`);
  console.log(`========================================`);

const channel = await client.channels.fetch('1557437302588973127');

if (channel && channel.isVoiceBased()) {
  joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true
  });

  console.log(`Ses kanalına bağlandı: ${channel.name}`);
}

  client.user.setActivity('Sunucuyu & Rolleri', { type: 3 }); // Watching

  const commands = [
    new SlashCommandBuilder()
      .setName('kurulum')
      .setDescription('Sunucu panellerini belirlenen kanallara manuel gönderir (Yönetici)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(option =>
        option
          .setName('panel')
          .setDescription('Kurulacak paneli seçin')
          .setRequired(true)
          .addChoices(
            { name: 'Kayıt Ol Paneli (Modal Formlu)', value: 'panel_register' },
            { name: 'Rol Alma Paneli (YouTube, Çekiliş, Etkinlik)', value: 'panel_roles' },
            { name: 'Destekçi Avantajları (Renk & 4 Title Kategori)', value: 'panel_supporter' }
          )
      ),

    new SlashCommandBuilder()
      .setName('seviye')
      .setDescription('Kullanıcının seviyesini ve XP kartını görüntüler')
      .addUserOption(option =>
        option.setName('kullanici').setDescription('Seviyesini görmek istediğiniz üye').setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('liderlik')
      .setDescription('Sunucunun en aktif üyelerini (XP Sıralaması) listeler')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    if (config.clientId && config.token && config.token !== 'BURAYA_BOT_TOKENI_GIRIN') {
      console.log('🔄 Slash komutları kaydediliyor...');
      if (config.guildId && config.guildId !== 'BURAYA_SUNUCU_ID_GIRIN') {
        await rest.put(
          Routes.applicationGuildCommands(config.clientId, config.guildId),
          { body: commands }
        );
        console.log('✅ Sunucuya özel Slash komutları başarıyla kaydedildi!');
      } else {
        await rest.put(
          Routes.applicationCommands(config.clientId),
          { body: commands }
        );
        console.log('✅ Genel Slash komutları başarıyla kaydedildi!');
      }
    }
  } catch (err) {
    console.error('❌ Slash komutları kaydedilirken hata oluştu:', err);
  }

  // Seste olanları hemen algıla
  client.guilds.cache.forEach(guild => {
    guild.channels.cache.filter(c => c.isVoiceBased()).forEach(voiceChannel => {
      voiceChannel.members.filter(m => !m.user.bot).forEach(member => {
        if (!voiceJoinMap.has(member.id)) {
          voiceJoinMap.set(member.id, Date.now());
        }
      });
    });
  });

  // Panelleri otomatik kontrol et
  await checkAndSendPanels();
});


// Bot kapatılırken seste olanların XP'lerini kaydet ve güvenli çıkış yap
async function gracefulShutdown() {
  console.log('\n🛑 Bot kapatılıyor, seste olan kullanıcıların süreleri kaydediliyor...');
  const now = Date.now();
  for (const [userId, joinTime] of voiceJoinMap.entries()) {
    const elapsedMs = now - joinTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (elapsedSeconds >= 10) {
      const elapsedMinutes = Math.floor(elapsedSeconds / 60);
      const xpPerMin = config.levelSettings?.xpPerVoiceMinute || 10;
      const xpGain = Math.max(1, elapsedMinutes * xpPerMin);
      db.addVoiceXp(userId, elapsedSeconds, xpGain);
    }
  }
  console.log('💾 Tüm seviyeler ve veriler database.sqlite dosyasına kalıcı olarak kaydedildi. Hoşça kalın!');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ==========================================
// 2. OTO-ROL & THE LOST NEMO HOŞGELDİN MESAJI
// ==========================================
client.on('guildMemberAdd', async (member) => {
  try {
    // 1. Kayıtsız Üye Rolünü Ver + Varsayılan Rolleri Ver
    const rolesToGive = [];

    if (config.roles.unregistered && config.roles.unregistered.length > 5) {
      const unregRole = member.guild.roles.cache.get(config.roles.unregistered);
      if (unregRole) rolesToGive.push(unregRole.id);
    }

    // Giriş varsayılan rolleri
    const defaultRoleIds = [
      '1557446897919205496',
      '1557446451276025857',
      '1557435008833290311',
      '1557446290537844808',
      '1557446122136412201'
    ];
    for (const roleId of defaultRoleIds) {
      if (member.guild.roles.cache.has(roleId)) {
        rolesToGive.push(roleId);
      }
    }

    if (rolesToGive.length > 0) {
      await member.roles.add(rolesToGive).catch(console.error);
    }

    // 2. Lost Nemo Havasında Sıcak & Enerjik Hoş Geldin Mesajı
    const welcomeChannelId = config.channels.welcome;
    let welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);
    if (!welcomeChannel && welcomeChannelId) {
      welcomeChannel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
    }

    if (welcomeChannel) {
      const memberCount = member.guild.memberCount;
      const accountCreatedAt = Math.floor(member.user.createdTimestamp / 1000);

      // Sunucu özel emojileri
      const waveEmoji = member.guild.emojis.cache.get('1537943557720244354')?.toString() || '<:gttrenter:1537943557720244354>';
      const infoEmoji = member.guild.emojis.cache.get('1537945016805359706')?.toString() || '<:gttrinfo:1537945016805359706>';
      const dateEmoji = member.guild.emojis.cache.get('1561141231499608197')?.toString() || '<a:donence:1561141231499608197>';
      const sandEmoji = member.guild.emojis.cache.get('1561141158841946183')?.toString() || '<:gergin:1561141158841946183>';
      const oceanEmoji = member.guild.emojis.cache.get('1561140978390405130')?.toString() || '<:tebrik:1561140978390405130>';

      const regChannelMention = config.channels.register ? `<#${config.channels.register}>` : '#kayıt-ol';

      const welcomeEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setAuthor({
          name: `${member.guild.name} Topluluğu`,
          iconURL: member.guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL()
        })
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(
          `# ${oceanEmoji} Aramıza Hoş Geldin, ${member.user.username}!\n\n` +
          `Seninle birlikte tam **${memberCount}** kişi olduk!\n\n` +
          `Hemen ${regChannelMention} kanalından kayıt olduktan sonra burada yeni arkadaşlarla tanışabilir, ses kanallarında sohbet edip ticaretin dibine vurabilirsin.\n\n` +
          `${infoEmoji} **Hesap:** ${member} (\`${member.id}\`)\n` +
          `${dateEmoji} **Discord'a Katılış:** <t:${accountCreatedAt}:R>\n` +
          `${sandEmoji} **Durum:** Kayıtsız Üye (Kayıt Olman Bekleniyor)`
        )
        .setFooter({
          text: 'İyi vakitler dileriz!'
        })
        .setTimestamp();

      const welcomeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Kayıt Ol')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${member.guild.id}/${config.channels.register || member.guild.id}`)
      );

      await welcomeChannel.send({
        content: `${waveEmoji} Selam ${member}, sunucumuza katıldın!`,
        embeds: [welcomeEmbed],
        components: [welcomeRow]
      });
    }
  } catch (error) {
    console.error('guildMemberAdd hatası:', error);
  }
});

// ==========================================
// 2B. SUNUCU ETİKETİ (CLAN TAG) KULLANIMI
// ==========================================
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // UsesClanTag flag = 1 << 6 = 64
    const CLAN_TAG_FLAG = 64;
    const hadTag = (oldMember.flags.bitfield & CLAN_TAG_FLAG) !== 0;
    const hasTag  = (newMember.flags.bitfield & CLAN_TAG_FLAG) !== 0;

    // Sadece yeni takan kişiyi yakala (daha önce yoktu, şimdi var)
    if (!hadTag && hasTag) {
      const tagRoleId     = '1561149610997587998';
      const chatChannelId = '1557444269957054636';

      // Rolü ver
      if (newMember.guild.roles.cache.has(tagRoleId)) {
        await newMember.roles.add(tagRoleId).catch(err => {
          console.error('Clan tag rolü verilemedi:', err.message);
        });
      }

      // Sohbet kanalına mesaj at
      let chatChannel = newMember.guild.channels.cache.get(chatChannelId);
      if (!chatChannel) {
        chatChannel = await newMember.guild.channels.fetch(chatChannelId).catch(() => null);
      }

      if (chatChannel) {
        await chatChannel.send(
          `<@${newMember.id}> Sunucu etiketimizi kullandığın için teşekkür ederiz desteğin bizim için çok değerli <:kalp:1561130373167980605>`
        ).catch(err => {
          console.error('Clan tag mesajı gönderilemedi:', err.message);
        });
      }

      console.log(`✅ ${newMember.user.tag} sunucu etiketini taktı, rol verildi.`);
    }
  } catch (err) {
    console.error('guildMemberUpdate (clan tag) hatası:', err.message);
  }
});

// ==========================================
// 3. SEVİYE & XP SİSTEMİ + KOMUTLAR
// ==========================================
client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return;

    // Duyuru Kanalı (1557440914467852408) - Her mesaja sırasıyla 5 tepki ekle
    const announcementChannelId = config.channels.announcement || '1557440914467852408';
    if (message.channel.id === announcementChannelId) {
      const announcementEmojis = [
        '1561863139853602836', // iğrenç
        '1561863137777688666', // kötü
        '1561863142240296991', // normal
        '1561863147399422152', // iyi
        '1561863145205669908'  // çok iyi
      ];

      for (const emojiId of announcementEmojis) {
        await message.react(emojiId).catch(err => {
          console.error(`Duyuru tepkisi eklenemedi (${emojiId}):`, err.message);
        });
      }
    }

    if (message.author.bot) return;

    const content = message.content.trim().toLowerCase();

    // !level, !levelsorgu, !rank, !seviye Komutları
    if (
      content === '!level' ||
      content.startsWith('!level ') ||
      content === '!levelsorgu' ||
      content.startsWith('!levelsorgu ') ||
      content === '!rank' ||
      content.startsWith('!rank ') ||
      content === '!seviye' ||
      content.startsWith('!seviye ')
    ) {
      const targetUser = message.mentions.users.first() || message.author;
      const embed = buildRankEmbed(targetUser, message.guild);
      return message.reply({ embeds: [embed] });
    }

    // !levelliste, !seviyeliste, !top, !liderlik Komutları
    if (content === '!levelliste' || content === '!seviyeliste' || content === '!top' || content === '!liderlik') {
      const embed = buildLeaderboardEmbed(message.guild, 10);
      return message.reply({ embeds: [embed] });
    }

    // Mesaj Seviye XP Takibi
    const userId = message.author.id;
    const now = Date.now();
    const cooldownSeconds = config.levelSettings?.messageCooldownSeconds || 45;
    const lastTime = messageCooldownMap.get(userId) || 0;

    if (now - lastTime < cooldownSeconds * 1000) return;
    messageCooldownMap.set(userId, now);

    const xpGain = config.levelSettings?.xpPerMessage || 15;
    const userData = db.addMessageXp(userId, xpGain, Math.floor(now / 1000));

    if (userData) {
      await checkLevelUp(message.guild, message.member, userData, message.channel);
    }
  } catch (err) {
    console.error('messageCreate hatası:', err.message);
  }
});

// Ses Süresi Seviye Takibi
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const userId = newState.id;
    const member = newState.member;
    if (!member || member.user.bot) return;

    if (!oldState.channelId && newState.channelId) {
      voiceJoinMap.set(userId, Date.now());
    } else if (oldState.channelId && !newState.channelId) {
      const joinTime = voiceJoinMap.get(userId);
      if (joinTime) {
        const elapsedMs = Date.now() - joinTime;
        voiceJoinMap.delete(userId);
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        if (elapsedSeconds >= 30) {
          const elapsedMinutes = Math.floor(elapsedSeconds / 60);
          const xpPerMin = config.levelSettings?.xpPerVoiceMinute || 10;
          const xpGain = Math.max(1, elapsedMinutes * xpPerMin);

          const userData = db.addVoiceXp(userId, elapsedSeconds, xpGain);
          if (userData) {
            await checkLevelUp(newState.guild, member, userData, null);
          }
        }
      }
    }
  } catch (err) {
    console.error('voiceStateUpdate hatası:', err.message);
  }
});

// Periyodik Ses XP Dağıtımı (Her 60 saniyede bir)
setInterval(async () => {
  try {
    const now = Date.now();
    for (const [userId, joinTime] of voiceJoinMap.entries()) {
      const elapsedMs = now - joinTime;
      if (elapsedMs >= 60000) {
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        const xpPerMin = config.levelSettings?.xpPerVoiceMinute || 10;
        const xpGain = elapsedMinutes * xpPerMin;

        voiceJoinMap.set(userId, now);

        const userData = db.addVoiceXp(userId, elapsedSeconds, xpGain);

        for (const guild of client.guilds.cache.values()) {
          const member = guild.members.cache.get(userId);
          if (member) {
            await checkLevelUp(guild, member, userData, null);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('Ses interval hatası:', err.message);
  }
}, 60000);

// Seviye Atlama Fonksiyonu ve Rol Teslimi (5-10-20-30-40-50-60-70-80-90-100)
async function checkLevelUp(guild, member, userData, channel) {
  if (!member || !guild) return;

  const currentLevel = calculateLevel(userData.xp);
  const oldLevel = userData.level || 0;

  if (currentLevel > oldLevel) {
    db.setLevel(member.id, currentLevel);

    const levelRolesMap = config.roles.levels || {};
    const milestoneLevels = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    let highestEligibleMilestone = null;
    for (const milestone of milestoneLevels) {
      if (currentLevel >= milestone && levelRolesMap[milestone] && !levelRolesMap[milestone].startsWith('SEVIYE_')) {
        highestEligibleMilestone = milestone;
      }
    }

    if (highestEligibleMilestone) {
      const targetRoleId = levelRolesMap[highestEligibleMilestone];
      const targetRole = guild.roles.cache.get(targetRoleId);

      for (const [lvl, roleId] of Object.entries(levelRolesMap)) {
        if (roleId && roleId !== targetRoleId && member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId).catch(() => {});
        }
      }

      if (targetRole && !member.roles.cache.has(targetRoleId)) {
        await member.roles.add(targetRole).catch(() => {});
      }
    }

    const nukeEmoji = guild.emojis.cache.get('1537945020441559070')?.toString() || '<:gttrnuke:1537945020441559070>';
    const omgEmoji = guild.emojis.cache.get('1561137442915098624')?.toString() || '<:omg:1561137442915098624>';
    const statsEmoji = guild.emojis.cache.get('1561137822528704532')?.toString() || '<:istatistik:1561137822528704532>';

    const levelUpEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription(
        `# ${nukeEmoji} SEVİYE ATLADIN!\n\n` +
        `Tebrikler ${member}! Sohbet ve seste gösterdiğin aktiflikle **Seviye ${currentLevel}** oldun! ${omgEmoji}\n\n` +
        `${statsEmoji} **İstatistiklerin:**\n` +
        `• **Toplam Mesaj:** \`${userData.messages}\` adet\n` +
        `• **Seste Geçirilen Süre:** \`${formatVoiceTime(userData.voice_seconds)}\`\n` +
        `• **Toplam XP:** \`${userData.xp.toLocaleString()}\` XP`
      )
      .setFooter({ text: `${guild.name}` })
      .setTimestamp();

    const targetChannelId = config.channels?.levelLog || '1561120379207032863';
    let logChannel = guild.channels.cache.get(targetChannelId);
    if (!logChannel) {
      logChannel = await guild.channels.fetch(targetChannelId).catch(() => null);
    }
    const finalChannel = logChannel || channel;
    if (finalChannel) {
      await finalChannel.send({ embeds: [levelUpEmbed] }).catch((err) => {
        console.error('Seviye atlama mesajı gönderilemedi:', err.message);
      });
    }
  }
}

// ==========================================
// 4. ETKİLEŞİMLER (INTERACTIONS: BUTONLAR, MODAL & MENÜLER)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    // ----------------------------------------
    // A) SLASH KOMUTLARI
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // 1. KURULUM KOMUTU (Manuel)
      if (commandName === 'kurulum') {
        const panelType = interaction.options.getString('panel');

        if (panelType === 'panel_register') {
          const payload = getRegisterPanelPayload(interaction.guild);
          await interaction.channel.send(payload);
          return interaction.reply({ content: '✅ Kayıt paneli kanala kuruldu!', ephemeral: true });
        }

        if (panelType === 'panel_roles') {
          const payload = getRolesPanelPayload(interaction.guild);
          await interaction.channel.send(payload);
          return interaction.reply({ content: '✅ Rol alma paneli kanala kuruldu!', ephemeral: true });
        }

        if (panelType === 'panel_supporter') {
          const payload = getSupporterPanelPayload(interaction.guild);
          await interaction.channel.send(payload);
          return interaction.reply({ content: '✅ Destekçi paneli kanala kuruldu!', ephemeral: true });
        }
      }

      // 2. SEVİYE / RANK KOMUTU
      if (commandName === 'seviye') {
        const targetUser = interaction.options.getUser('kullanici') || interaction.user;
        const embed = buildRankEmbed(targetUser, interaction.guild);
        return interaction.reply({ embeds: [embed] });
      }

      // 3. LİDERLİK TABLOSU
      if (commandName === 'liderlik') {
        const embed = buildLeaderboardEmbed(interaction.guild, 10);
        return interaction.reply({ embeds: [embed] });
      }
    }

    // ----------------------------------------
    // B) KAYIT BUTONU -> CİNSİYET SEÇİMİ (Adım 1)
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId === 'btn_open_reg_modal') {
      // Daha önce kayıtlı mı kontrol et
      const existingUser = db.getUser(interaction.user.id);
      if (existingUser && existingUser.registered) {
        return interaction.reply({
          content: '✅ Zaten kayıtlısın! Tekrar kayıt yapamazsın.',
          flags: 64
        });
      }

      const genderEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('<:Growpedia:1561556279225225236> Kayıt Formu • Adım 1 / 2')
        .setDescription(
          `**Cinsiyetinizi seçiniz:**\n\n` +
          `<:gttrwarn:1537943562111680623> Gerçek cinsiyetinizi seçmeniz zorunludur, yanlış seçim yaptırımlara yol açabilir.`
        );

      const genderRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('reg_gender_male')
          .setLabel('Erkek')
          .setEmoji('1561853137222897694')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('reg_gender_female')
          .setLabel('Kız')
          .setEmoji('1561853134723358823')
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({ embeds: [genderEmbed], components: [genderRow], flags: 64 });
    }

    // ----------------------------------------
    // B2) CİNSİYET SEÇİLDİ -> OYUN TARZI SEÇİMİ (Adım 2)
    // ----------------------------------------
    if (interaction.isButton() && (interaction.customId === 'reg_gender_male' || interaction.customId === 'reg_gender_female')) {
      const selectedGender = interaction.customId === 'reg_gender_male' ? 'male' : 'female';
      const genderDisplay = selectedGender === 'male' ? '<:male:1561853137222897694> Erkek' : '<:female:1561853134723358823> Kız';

      const playstyleEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('<:Growpedia:1561556279225225236> Kayıt Formu • Adım 2 / 2')
        .setDescription(
          `**Oyun tarzınızı seçiniz:**\n` +
          `<:gttrwarn:1537943562111680623> Birden fazla seçebilirsiniz. Seçimi iptal etmek için tekrar tıklayın.\n\n` +
          `<:gttrcheckbox:1537945018809974814> Legal <:agac:1558168928402800751>\n` +
          `<:gttrcheckbox:1537945018809974814> İllegal <:rulet:1561853989790818304>`
        );

      // State: "00" = hiçbiri, "10" = legal, "01" = illegal, "11" = ikisi
      const playstyleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reg_ps_legal__${selectedGender}__00`)
          .setLabel('Legal')
          .setEmoji('1558168928402800751')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`reg_ps_illegal__${selectedGender}__00`)
          .setLabel('İllegal')
          .setEmoji('1561853989790818304')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`reg_ps_confirm__${selectedGender}__00`)
          .setLabel('Onayla')
          .setEmoji('1561556279225225236')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true)
      );

      return interaction.update({ embeds: [playstyleEmbed], components: [playstyleRow] });
    }

    // ----------------------------------------
    // C) OYUN TARZI TOGGLE (Legal / İllegal seç/bırak)
    // ----------------------------------------
    if (interaction.isButton() && (interaction.customId.startsWith('reg_ps_legal__') || interaction.customId.startsWith('reg_ps_illegal__'))) {
      const parts = interaction.customId.split('__');
      const action = parts[0].replace('reg_ps_', ''); // "legal" veya "illegal"
      const gender = parts[1]; // "male" veya "female"
      let state = parts[2]; // "00", "10", "01", "11"

      // Toggle
      if (action === 'legal') {
        state = state[0] === '1' ? '0' + state[1] : '1' + state[1];
      } else {
        state = state[0] + (state[1] === '1' ? '0' : '1');
      }

      const legalOn = state[0] === '1';
      const illegalOn = state[1] === '1';

      // Checkbox emojisi: seçilmezse 1537945018809974814, seçilince 1537941148394455101
      const cbOn  = '1537941148394455101';
      const cbOff = '1537945018809974814';
      const legalLine   = `<:${legalOn   ? 'gttrcheck' : 'gttrcheckbox'}:${legalOn   ? cbOn : cbOff}> Legal <:agac:1558168928402800751>`;
      const illegalLine = `<:${illegalOn ? 'gttrcheck' : 'gttrcheckbox'}:${illegalOn ? cbOn : cbOff}> İllegal <:rulet:1561853989790818304>`;

      const updatedEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('<:Growpedia:1561556279225225236> Kayıt Formu • Adım 2 / 2')
        .setDescription(
          `**Oyun tarzınızı seçiniz:**\n` +
          `<:gttrwarn:1537943562111680623> Birden fazla seçebilirsiniz. Seçimi iptal etmek için tekrar tıklayın.\n\n` +
          `${legalLine}\n${illegalLine}`
        );

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reg_ps_legal__${gender}__${state}`)
          .setLabel('Legal')
          .setEmoji('1558168928402800751')
          .setStyle(legalOn ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`reg_ps_illegal__${gender}__${state}`)
          .setLabel('İllegal')
          .setEmoji('1561853989790818304')
          .setStyle(illegalOn ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`reg_ps_confirm__${gender}__${state}`)
          .setLabel('Onayla')
          .setEmoji('1561556279225225236')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!legalOn && !illegalOn)
      );

      return interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
    }

    // ----------------------------------------
    // D_REG) KAYIT ONAYLAMA -> TAMAMLAMA
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('reg_ps_confirm__')) {
      await interaction.deferUpdate(); // Yavaş işlem: rol ekleme + kanal bulma
      const parts = interaction.customId.split('__');
      const detectedGender = parts[1]; // male | female
      const state = parts[2]; // "10", "01", "11"

      const legalOn = state[0] === '1';
      const illegalOn = state[1] === '1';

      const member = interaction.member;
      const userId = interaction.user.id;

      const genderDisplay = detectedGender === 'male' ? '🧍 Erkek' : '👩 Kadın';
      const genderRoleId = detectedGender === 'male' ? config.roles.gender.male : config.roles.gender.female;

      let detectedPlaystyle = legalOn && illegalOn ? 'both' : legalOn ? 'legal' : 'illegal';
      let playstyleDisplay = legalOn && illegalOn ? '⚡ Legal & İllegal' : legalOn ? '⚖️ Legal' : '💀 İllegal';

      const rolesToAdd = [];
      const rolesToRemove = [];

      // Cinsiyet rolü
      if (genderRoleId && interaction.guild.roles.cache.has(genderRoleId)) {
        rolesToAdd.push(genderRoleId);
      }

      // Oyun tarzı rolleri
      if (legalOn) {
        if (config.roles.playstyle?.legal && interaction.guild.roles.cache.has(config.roles.playstyle.legal)) {
          rolesToAdd.push(config.roles.playstyle.legal);
        }
      }
      if (illegalOn) {
        if (config.roles.playstyle?.illegal && interaction.guild.roles.cache.has(config.roles.playstyle.illegal)) {
          rolesToAdd.push(config.roles.playstyle.illegal);
        }
      }
      if (legalOn && illegalOn) {
        if (config.roles.playstyle?.both && interaction.guild.roles.cache.has(config.roles.playstyle.both)) {
          rolesToAdd.push(config.roles.playstyle.both);
        }
      }

      // Kayıtlı üye rolü
      if (config.roles.registered && interaction.guild.roles.cache.has(config.roles.registered)) {
        rolesToAdd.push(config.roles.registered);
      }

      // Kayıtsız rolünü sil
      if (config.roles.unregistered && member.roles.cache.has(config.roles.unregistered)) {
        rolesToRemove.push(config.roles.unregistered);
      }

      if (rolesToAdd.length > 0) await member.roles.add(rolesToAdd).catch(console.error);
      if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove).catch(console.error);

      // Veritabanına kaydet
      db.completeRegistration(userId, detectedGender, detectedPlaystyle, member.user.username);

      // Kayıt log kanalına gönder
      const regLogChannelId = config.channels.registerLog || '1561124251757715476';
      let regLogChannel = interaction.guild.channels.cache.get(regLogChannelId);
      if (!regLogChannel) {
        regLogChannel = await interaction.guild.channels.fetch(regLogChannelId).catch(() => null);
      }
      if (regLogChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setAuthor({
            name: `${member.user.tag} sunucuya kaydoldu!`,
            iconURL: member.user.displayAvatarURL({ dynamic: true })
          })
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
          .setDescription(
            `📝 **Yeni Kayıt Bilgileri:**\n\n` +
            `👤 **Kullanıcı:** ${member} (\`${member.id}\`)\n` +
            `🚻 **Cinsiyet:** ${genderDisplay}\n` +
            `🎮 **Oyun Tarzı:** ${playstyleDisplay}\n` +
            `📅 **Kayıt Zamanı:** <t:${Math.floor(Date.now() / 1000)}:F> (<t:${Math.floor(Date.now() / 1000)}:R>)\n` +
            `👥 **Toplam Üye:** \`${interaction.guild.memberCount}\``
          )
          .setFooter({ text: `${interaction.guild.name} • Kayıt Log` })
          .setTimestamp();

        await regLogChannel.send({ embeds: [logEmbed] }).catch(err => {
          console.error('Kayıt log kanalına mesaj atılamadı:', err.message);
        });
      }

      const successEmbed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('🎉 Kaydın Başarıyla Tamamlandı!')
        .setDescription(
          `Hoş geldin ${member}! Seçtiğin bilgilere göre rollerin tanımlandı ve tüm kanallar açıldı.\n\n` +
          `• **Cinsiyet:** ${genderDisplay}\n` +
          `• **Oyun Tarzı:** ${playstyleDisplay}\n` +
          `• **Statü:** ✅ Kayıtlı Üye\n\n` +
          `Sunucuda iyi eğlenceler, bol kazançlar dileriz! 🎮`
        )
        .setFooter({ text: `${interaction.guild.name} • İyi oyunlar!` });

      return interaction.editReply({ embeds: [successEmbed], components: [] });
    }

    // ----------------------------------------
    // D) ROL ALMA / BIRAKMA BUTONLARI (TOGGLE)
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('btn_role_')) {
      const roleKey = interaction.customId.replace('btn_role_', '');
      const member = interaction.member;

      let roleId = null;
      let isPlaystyle = false;

      if (roleKey === 'legal') {
        roleId = config.roles.playstyle?.legal;
        isPlaystyle = true;
      } else if (roleKey === 'illegal') {
        roleId = config.roles.playstyle?.illegal;
        isPlaystyle = true;
      } else {
        roleId = config.roles.notifications?.[roleKey];
      }

      if (!roleId || !interaction.guild.roles.cache.has(roleId)) {
        return interaction.reply({
          content: '<:gttrwarn:1537943562111680623> Bu rol sunucuda veya yapılandırma dosyasında bulunamadı.',
          flags: 64
        });
      }

      const role = interaction.guild.roles.cache.get(roleId);

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);

        if (isPlaystyle) {
          const hasLegal = roleKey !== 'legal' && member.roles.cache.has(config.roles.playstyle.legal);
          const hasIllegal = roleKey !== 'illegal' && member.roles.cache.has(config.roles.playstyle.illegal);
          const newPs = (hasLegal && hasIllegal) ? 'both' : hasLegal ? 'legal' : hasIllegal ? 'illegal' : null;
          db.updateUserPlaystyle(member.id, newPs);
        }

        return interaction.reply({
          content: `<:gttrno:1537945026611519529> **${role.name}** rolü üzerinden alındı.`,
          flags: 64
        });
      } else {
        await member.roles.add(roleId);

        if (isPlaystyle) {
          const hasLegal = roleKey === 'legal' || member.roles.cache.has(config.roles.playstyle.legal);
          const hasIllegal = roleKey === 'illegal' || member.roles.cache.has(config.roles.playstyle.illegal);
          const newPs = (hasLegal && hasIllegal) ? 'both' : hasLegal ? 'legal' : hasIllegal ? 'illegal' : null;
          db.updateUserPlaystyle(member.id, newPs);
        }

        return interaction.reply({
          content: `<:gttryes:1537945024203849850> **${role.name}** rolü başarıyla verildi!`,
          flags: 64
        });
      }
    }

    // ----------------------------------------
    // E) DESTEKÇİ MENÜLERİ (RENK VE 4 TITLE KATEGORİ)
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      const member = interaction.member;

      const isBooster = member.premiumSince !== null || (config.roles.booster && member.roles.cache.has(config.roles.booster));
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

      if (!isBooster && !isAdmin) {
        return interaction.reply({
          content: '<:gttrkey:1537943553743917057> **Bu menü sunucu takviyecilerine özeldir!** Sunucuya takviye basarak bu ayrıcalıkları anında açabilirsin.',
          ephemeral: true
        });
      }

      // 1. RENK ROLÜ SEÇİMİ (Önceki rengi sil, yenisini ver!)
      if (interaction.customId === 'menu_supporter_color') {
        const selectedValue = interaction.values[0];
        const allColorRoleIds = (config.roles.colors || []).map(c => c.id).filter(id => !id.startsWith('RENK_') && !id.startsWith('BRIGHT_') && !id.startsWith('PINKY_') && !id.startsWith('CRAZY_') && !id.startsWith('PALE_') && !id.startsWith('MEDIUM_') && !id.startsWith('LIGHT_') && !id.startsWith('DARK_'));

        const rolesToRemove = allColorRoleIds.filter(id => member.roles.cache.has(id));
        if (rolesToRemove.length > 0) {
          await member.roles.remove(rolesToRemove).catch(console.error);
        }

        if (selectedValue === 'color_remove') {
          return interaction.reply({ content: '<:gttryes:1537945024203849850> Renk rolün başarıyla kaldırıldı.', ephemeral: true });
        }

        const newRoleId = selectedValue.replace('color_', '');
        const newRole = interaction.guild.roles.cache.get(newRoleId);

        if (newRole) {
          await member.roles.add(newRole);
          return interaction.reply({
            content: `<:gttryes:1537945024203849850> İsim rengin **${newRole.name}** olarak ayarlandı! Eski rengin temizlendi.`,
            ephemeral: true
          });
        } else {
          return interaction.reply({ content: '⚠️ Seçilen renk rolü henüz sunucuda bulunamadı veya ID girilmedi.', ephemeral: true });
        }
      }

      // 2. TITLE / KATEGORİ ROLÜ SEÇİMİ (Önceki title sil, yenisini ver!)
      if (interaction.customId === 'menu_supporter_category') {
        const selectedValue = interaction.values[0];
        const allCatRoleIds = (config.roles.supporterCategories || []).map(c => c.id).filter(id => !id.endsWith('_ROL_ID'));

        const rolesToRemove = allCatRoleIds.filter(id => member.roles.cache.has(id));
        if (rolesToRemove.length > 0) {
          await member.roles.remove(rolesToRemove).catch(console.error);
        }

        if (selectedValue === 'cat_remove') {
          return interaction.reply({ content: '<:gttryes:1537945024203849850> Koleksiyon rolün başarıyla kaldırıldı.', ephemeral: true });
        }

        const newRoleId = selectedValue.replace('cat_', '');
        const newRole = interaction.guild.roles.cache.get(newRoleId);

        if (newRole) {
          await member.roles.add(newRole);
          return interaction.reply({
            content: `<:gttryes:1537945024203849850> Özel rolünüz başarıyla verildi! Eski rolünüz temizlendi.`,
            ephemeral: true
          });
        } else {
          return interaction.reply({ content: '⚠️ Seçilen title rolü sunucuda bulunamadı veya config.json dosyasında ID güncellenmedi.', ephemeral: true });
        }
      }
    }

    // ----------------------------------------
    // ÖNERİ BUTONU -> MODAL
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId === 'btn_suggest') {
      const modal = new ModalBuilder()
        .setCustomId('modal_suggestion')
        .setTitle('Öneri Gönder');

      const suggestionInput = new TextInputBuilder()
        .setCustomId('suggestion_text')
        .setLabel('Önerin nedir?')
        .setPlaceholder('Önerini buraya açık ve anlaşılır şekilde yaz...')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(10)
        .setMaxLength(1000)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(suggestionInput));
      return interaction.showModal(modal);
    }

    // ----------------------------------------
    // ÖNERİ MODAL GÖNDERİLDİ
    // ----------------------------------------
    if (interaction.isModalSubmit() && interaction.customId === 'modal_suggestion') {
      const text = interaction.fields.getTextInputValue('suggestion_text');
      const user = interaction.user;
      const member = interaction.member;

      const suggestionChannelId = config.channels.suggestionLog || config.channels.suggestion;
      let suggestionChannel = interaction.guild.channels.cache.get(suggestionChannelId);
      if (!suggestionChannel) {
        suggestionChannel = await interaction.guild.channels.fetch(suggestionChannelId).catch(() => null);
      }

      if (!suggestionChannel) {
        return interaction.reply({ content: '❌ Öneri kanalı bulunamadı.', flags: 64 });
      }

      const suggestionEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({
          name: `${user.tag} bir öneri gönderdi!`,
          iconURL: user.displayAvatarURL({ dynamic: true })
        })
        .setDescription(`**📝 Öneri:**\n${text}`)
        .addFields(
          { name: '👤 Kullanıcı', value: `${member} (\`${user.id}\`)`, inline: true },
          { name: '📅 Tarih', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        )
        .setFooter({ text: `${interaction.guild.name} • Öneri Sistemi` })
        .setTimestamp();

      const sentMsg = await suggestionChannel.send({ embeds: [suggestionEmbed] });

      // Oylama emojileri ekle
      await sentMsg.react('👍').catch(() => {});
      await sentMsg.react('👎').catch(() => {});

      return interaction.reply({
        content: '<:oner:1561859540935376957> Önerin başarıyla gönderildi! Yetkili ekibimiz değerlendirecek.',
        flags: 64
      });
    }

    // ========================================
    // YETKİLİ BAŞVURU SİSTEMİ
    // ========================================

    // 1. BAŞVURU YAP BUTONUNA TIKLANDI -> ADIM 1 MODAL
    if (interaction.isButton() && interaction.customId === 'btn_staff_apply') {
      const member = interaction.member;
      const pendingRoleId = config.roles.staffPending;

      if (pendingRoleId && member.roles.cache.has(pendingRoleId)) {
        return interaction.reply({
          content: `<:gttrwarn:1537943562111680623> Üzerinizde <@&${pendingRoleId}> rolü bulunmaktadır! Bu rol yetkili ekibi tarafından üzerinizden alınmadan yeni bir başvuru yapamazsınız.`,
          flags: 64
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('modal_staff_app_1')
        .setTitle('Yetkili Başvuru • Adım 1 / 3');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q1').setLabel('1. İsim ve Soyisim').setPlaceholder('Gerçek isim ve soyisminizi yazın').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q2').setLabel('2. Yaş').setPlaceholder('Kaç yaşındasınız?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q3').setLabel('3. Discord Kullanıcı Adı').setPlaceholder('Discord kullanıcı adınızı yazın').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q4').setLabel('4. Günlük Aktiflik').setPlaceholder('Günde ortalama kaç saat aktif olabilirsiniz?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q5').setLabel('5. Aktif Olduğun Saatler').setPlaceholder('Genellikle hangi saatlerde çevrim içi oluyorsun?').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    // 2. ADIM 1 MODAL GÖNDERİLDİ -> ADIM 2'YE GEÇİŞ BUTONU
    if (interaction.isModalSubmit() && interaction.customId === 'modal_staff_app_1') {
      staffAppDrafts.set(interaction.user.id, {
        q1: interaction.fields.getTextInputValue('app_q1'),
        q2: interaction.fields.getTextInputValue('app_q2'),
        q3: interaction.fields.getTextInputValue('app_q3'),
        q4: interaction.fields.getTextInputValue('app_q4'),
        q5: interaction.fields.getTextInputValue('app_q5')
      });

      const nextEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('<:tebrik:1561140978390405130> 1. Adım Tamamlandı!')
        .setDescription(
          `Temel bilgileriniz başarıyla kaydedildi.\n\n` +
          `<:gttrright:1537943550069706792> Şimdi yetkililik geçmişinizi ve hedeflerinizi belirtmek için aşağıdaki butona tıklayarak **2. Adıma** geçin.`
        );

      const nextRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_staff_step_2')
          .setLabel('2. Adıma Geç (Yetkililik & Sunucu)')
          .setEmoji('1537943550069706792')
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({ embeds: [nextEmbed], components: [nextRow], flags: 64 });
    }

    // 3. ADIM 2 BUTONUNA TIKLANDI -> ADIM 2 MODAL
    if (interaction.isButton() && interaction.customId === 'btn_staff_step_2') {
      const modal = new ModalBuilder()
        .setCustomId('modal_staff_app_2')
        .setTitle('Yetkili Başvuru • Adım 2 / 3');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q6').setLabel('6. Önceki Yetkililik Deneyimi').setPlaceholder('Daha önce başka bir sunucuda yetkili oldunuz mu? Anlatın.').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q7').setLabel('7. Başvuru Sebebi').setPlaceholder('Ekibimize katılmak istemenizin sebebi nedir?').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q8').setLabel('8. Sunucuya Katkı').setPlaceholder('Sunucuya ve topluluğa ne gibi katkılar sağlayabilirsiniz?').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    // 4. ADIM 2 MODAL GÖNDERİLDİ -> ADIM 3'E GEÇİŞ BUTONU
    if (interaction.isModalSubmit() && interaction.customId === 'modal_staff_app_2') {
      const draft = staffAppDrafts.get(interaction.user.id) || {};
      draft.q6 = interaction.fields.getTextInputValue('app_q6');
      draft.q7 = interaction.fields.getTextInputValue('app_q7');
      draft.q8 = interaction.fields.getTextInputValue('app_q8');
      staffAppDrafts.set(interaction.user.id, draft);

      const nextEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('<:tebrik:1561140978390405130> 2. Adım Tamamlandı!')
        .setDescription(
          `Deneyim ve hedefleriniz kaydedildi.\n\n` +
          `<:gttrright:1537943550069706792> Son olarak senaryo ve kriz yönetimi sorularını yanıtlamak için aşağıdaki butona tıklayarak **Son Adıma** geçin.`
        );

      const nextRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_staff_step_3')
          .setLabel('Son Adıma Geç (Senaryolar & Bitiş)')
          .setEmoji('1537943550069706792')
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({ embeds: [nextEmbed], components: [nextRow], flags: 64 });
    }

    // 5. ADIM 3 BUTONUNA TIKLANDI -> ADIM 3 MODAL
    if (interaction.isButton() && interaction.customId === 'btn_staff_step_3') {
      const modal = new ModalBuilder()
        .setCustomId('modal_staff_app_3')
        .setTitle('Yetkili Başvuru • Adım 3 / 3');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q9').setLabel('9. Sorun Çözme Yeteneği').setPlaceholder('İki üye arasında tartışma çıkarsa nasıl bir yol izlersin?').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q10').setLabel('10. Kural İhlalleri ve Tarafsızlık').setPlaceholder('Yakın arkadaşın kural ihlali yaparsa ne yaparsın?').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q11').setLabel('11. Ekip Çalışması').setPlaceholder('Diğer yetkililerle anlaşmazlık yaşarsan nasıl çözersin?').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('app_q12').setLabel('12. Eklemek İstedikleriniz (İsteğe Bağlı)').setPlaceholder('Eklemek istediğiniz başka bir bilgi var mı?').setStyle(TextInputStyle.Paragraph).setRequired(false)
        )
      );

      return interaction.showModal(modal);
    }

    // 6. ADIM 3 MODAL GÖNDERİLDİ -> BAŞVURU BİTTİ, ROL VERİLİR, KANALA DÜŞER
    if (interaction.isModalSubmit() && interaction.customId === 'modal_staff_app_3') {
      await interaction.deferReply({ flags: 64 }); // Yavaş işlem: rol + kanal
      const draft = staffAppDrafts.get(interaction.user.id) || {};
      const allAnswers = {
        ...draft,
        q9: interaction.fields.getTextInputValue('app_q9'),
        q10: interaction.fields.getTextInputValue('app_q10'),
        q11: interaction.fields.getTextInputValue('app_q11'),
        q12: interaction.fields.getTextInputValue('app_q12') || 'Belirtilmedi'
      };
      staffAppDrafts.delete(interaction.user.id);

      const user = interaction.user;
      const member = interaction.member;

      // Başvuran kullanıcıya "Yetkili Başvuru!" rolü ver (1561548099921510430)
      if (config.roles.staffPending) {
        await member.roles.add(config.roles.staffPending).catch(console.error);
      }

      // Başvuru inceleme kanalına gönder (1561877085067280384)
      const reviewChannelId = config.channels.staffAppReview;
      let reviewChannel = interaction.guild.channels.cache.get(reviewChannelId);
      if (!reviewChannel) {
        reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
      }

      if (reviewChannel) {
        const appEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setAuthor({ name: `${user.tag} Yetkili Başvurusu Gönderdi`, iconURL: user.displayAvatarURL({ dynamic: true }) })
          .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
          .setDescription(
            `👤 **Aday:** ${member} (\`${user.id}\`)\n` +
            `📅 **Başvuru Zamanı:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
            `⏳ **Durum:** İnceleniyor`
          )
          .addFields(
            { name: '1. İsim ve Soyisim', value: allAnswers.q1 || '-', inline: true },
            { name: '2. Yaş', value: allAnswers.q2 || '-', inline: true },
            { name: '3. Discord Kullanıcı Adı', value: allAnswers.q3 || '-', inline: true },
            { name: '4. Günlük Aktiflik', value: allAnswers.q4 || '-', inline: true },
            { name: '5. Aktif Olduğu Saatler', value: allAnswers.q5 || '-', inline: true },
            { name: '6. Önceki Yetkililik Deneyimi', value: allAnswers.q6 || '-', inline: false },
            { name: '7. Başvuru Sebebi', value: allAnswers.q7 || '-', inline: false },
            { name: '8. Sunucuya Katkı', value: allAnswers.q8 || '-', inline: false },
            { name: '9. Sorun Çözme Yeteneği', value: allAnswers.q9 || '-', inline: false },
            { name: '10. Kural İhlalleri ve Tarafsızlık', value: allAnswers.q10 || '-', inline: false },
            { name: '11. Ekip Çalışması', value: allAnswers.q11 || '-', inline: false },
            { name: '12. Eklemek İstedikleri', value: allAnswers.q12 || 'Yok', inline: false }
          )
          .setFooter({ text: `${interaction.guild.name} • Yetkili Alımları` })
          .setTimestamp();

        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`staff_accept__${user.id}`)
            .setLabel('Onayla')
            .setEmoji('1537945024203849850')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`staff_reject__${user.id}`)
            .setLabel('Reddet')
            .setEmoji('1537945026611519529')
            .setStyle(ButtonStyle.Danger)
        );

        const reviewMsg = await reviewChannel.send({ embeds: [appEmbed], components: [actionRow] });
      }

      return interaction.editReply({
        content:
          `<:gttryes:1537945024203849850> **Yetkili başvurunuz başarıyla alındı!**\n\n` +
          `<:gttrright:1537943550069706792> <@&${config.roles.staffPending}> rolünüz tanımlandı.\n` +
          `<:gttrright:1537943550069706792> Başvurunuz yetkili ekibimiz tarafından değerlendirildikten sonra sonucunuz <#${config.channels.staffAppResults || interaction.channelId}> kanalında açıklanacaktır. Başarılar dileriz!`
      });
    }

    // 7. YETKİLİ BAŞVURU ONAYLAMA
    if (interaction.isButton() && interaction.customId.startsWith('staff_accept__')) {
      const targetUserId = interaction.customId.split('__')[1];
      const staffMember = interaction.member;

      // Yetkili mi kontrol et (Yönetici veya Yetkili Rolleri)
      const isStaff = staffMember.permissions.has(PermissionFlagsBits.Administrator) || staffMember.roles.cache.some(r => r.name.toLowerCase().includes('yetkili'));
      if (!isStaff) {
        return interaction.reply({ content: '<:gttrwarn:1537943562111680623> Bu işlemi yalnızca yetkili ekibi gerçekleştirebilir!', flags: 64 });
      }

      await interaction.deferUpdate(); // Yavaş işlem: rol + kanal + mesaj

      const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

      if (targetMember) {
        // Yetkili başvuru rolü kalır, onaylandı rolü eklenir
        if (config.roles.staffAccepted) {
          await targetMember.roles.add(config.roles.staffAccepted).catch(() => {});
        }
      }

      // İnceleme mesajını güncelle
      const oldEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(oldEmbed)
        .setColor(0x00ff88)
        .setDescription(
          oldEmbed.description.replace('⏳ **Durum:** İnceleniyor', `✅ **Durum:** ONAYLANDI\n🛡️ **Onaylayan Yetkili:** ${staffMember} (\`${staffMember.user.tag}\`)`)
        );

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('staff_done_accept').setLabel(`Onaylandı (${interaction.user.username})`).setEmoji('1537945024203849850').setStyle(ButtonStyle.Success).setDisabled(true)
      );

      await interaction.editReply({ embeds: [updatedEmbed], components: [disabledRow] });

      // Sonuç kanalına duyuru at (1561872568628019200)
      const resultsChannelId = config.channels.staffAppResults;
      let resultsChannel = interaction.guild.channels.cache.get(resultsChannelId);
      if (!resultsChannel) {
        resultsChannel = await interaction.guild.channels.fetch(resultsChannelId).catch(() => null);
      }

      if (resultsChannel) {
        const resultEmbed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('<:Growpedia:1561556279225225236> Yetkili Başvuru Sonucu: ONAYLANDI!')
          .setDescription(
            `🎉 Tebrikler <@${targetUserId}>! Yetkili başvurunuz yetkili ekibimiz tarafından incelenmiş ve **kabul edilmiştir**!\n\n` +
            `<:gttrright:1537943550069706792> Lütfen en kısa sürede aktif bir Yetkili Sorumlusuyla iletişime geçiniz.`
          )
          .setFooter({ text: `${interaction.guild.name} • Başvuru Sonuçları` })
          .setTimestamp();

        await resultsChannel.send({ content: `<@${targetUserId}>`, embeds: [resultEmbed] });
      }
      return;
    }

    // 8. YETKİLİ BAŞVURU REDDETME BUTONUNA TIKLANDI -> SEBEP MODAL'I AÇ
    if (interaction.isButton() && interaction.customId.startsWith('staff_reject__')) {
      const targetUserId = interaction.customId.split('__')[1];
      const staffMember = interaction.member;

      const isStaff = staffMember.permissions.has(PermissionFlagsBits.Administrator) || staffMember.roles.cache.some(r => r.name.toLowerCase().includes('yetkili'));
      if (!isStaff) {
        return interaction.reply({ content: '<:gttrwarn:1537943562111680623> Bu işlemi yalnızca yetkili ekibi gerçekleştirebilir!', flags: 64 });
      }
      // Modal açmadan önce defer YOK — modal showModal() ile hemen cevap verilmeli

      const modal = new ModalBuilder()
        .setCustomId(`modal_staff_reject__${targetUserId}__${interaction.message.id}`)
        .setTitle('Başvuru Reddetme Sebebi');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reject_reason')
            .setLabel('Reddedilme Sebebi')
            .setPlaceholder('Başvurunun reddedilme gerekçesini yazınız...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    // 9. YETKİLİ BAŞVURU REDDETME MODAL'I GÖNDERİLDİ
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_staff_reject__')) {
      await interaction.deferReply({ flags: 64 }); // Yavaş işlem: mesaj düzenleme + kanal
      const parts = interaction.customId.split('__');
      const targetUserId = parts[1];
      const reviewMsgId = parts[2];
      const reason = interaction.fields.getTextInputValue('reject_reason');
      const staffMember = interaction.member;

      const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

      if (targetMember) {
        // Yetkili başvuru rolü kalır, reddedildi rolü eklenir
        if (config.roles.staffRejected) {
          await targetMember.roles.add(config.roles.staffRejected).catch(() => {});
        }
      }

      // İnceleme kanalındaki mesajı güncelle
      const reviewChannelId = config.channels.staffAppReview;
      let reviewChannel = interaction.guild.channels.cache.get(reviewChannelId);
      if (!reviewChannel) {
        reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
      }

      if (reviewChannel && reviewMsgId) {
        const reviewMsg = await reviewChannel.messages.fetch(reviewMsgId).catch(() => null);
        if (reviewMsg && reviewMsg.embeds[0]) {
          const oldEmbed = reviewMsg.embeds[0];
          const updatedEmbed = EmbedBuilder.from(oldEmbed)
            .setColor(0xed4245)
            .setDescription(
              oldEmbed.description.replace('⏳ **Durum:** İnceleniyor', `❌ **Durum:** REDDEDİLDİ\n🛡️ **Reddeden Yetkili:** ${staffMember} (\`${staffMember.user.tag}\`)\n📝 **Sebep:** ${reason}`)
            );

          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('staff_done_reject').setLabel(`Reddedildi (${interaction.user.username})`).setEmoji('1537945026611519529').setStyle(ButtonStyle.Danger).setDisabled(true)
          );

          await reviewMsg.edit({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => {});
        }
      }

      // Sonuç kanalına duyuru at (1561872568628019200)
      const resultsChannelId = config.channels.staffAppResults;
      let resultsChannel = interaction.guild.channels.cache.get(resultsChannelId);
      if (!resultsChannel) {
        resultsChannel = await interaction.guild.channels.fetch(resultsChannelId).catch(() => null);
      }

      if (resultsChannel) {
        const resultEmbed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('<:Growpedia:1561556279225225236> Yetkili Başvuru Sonucu: REDDEDİLDİ')
          .setDescription(
            `<:gttrno:1537945026611519529> Üzgünüz <@${targetUserId}>, yetkili başvurunuz ekibimiz tarafından **reddedilmiştir**.\n\n` +
            `📝 **Sebep:** ${reason}\n\n` +
            `<:gttrwarn:1537943562111680623> *1 hafta sonra kendinizi geliştirip tekrar başvuruda bulunabilirsiniz.*`
          )
          .setFooter({ text: `${interaction.guild.name} • Başvuru Sonuçları` })
          .setTimestamp();

        await resultsChannel.send({ content: `<@${targetUserId}>`, embeds: [resultEmbed] });
      }

      return interaction.editReply({
        content: `<:gttrno:1537945026611519529> Başvuru başarıyla reddedildi, rol verildi ve sebep sonuç kanalına duyuruldu.`
      });
    }

    // ========================================
    // YETKİLİ ŞİKAYET SİSTEMİ (TICKET)
    // ========================================

    // 1. ŞİKAYET TALEBİ AÇ BUTONU
    if (interaction.isButton() && interaction.customId === 'btn_staff_complaint_open') {
      const user = interaction.user;
      const member = interaction.member;
      const cleanUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15) || 'uye';
      const ticketChannelName = `sikayet-${cleanUsername}`;

      // Zaten açık talebi var mı kontrol et
      const existingChannel = interaction.guild.channels.cache.find(c =>
        c.name === ticketChannelName &&
        c.parentId === interaction.channel.parentId
      );

      if (existingChannel) {
        return interaction.reply({
          content: `<:gttrwarn:1537943562111680623> Zaten açık bir yetkili şikayet talebiniz bulunmaktadır: ${existingChannel}`,
          flags: 64
        });
      }

      // Kanal oluşturma + mesaj gönderme yavaş olduğundan önce defer al
      await interaction.deferReply({ flags: 64 });

      const overwrites = [
        {
          id: interaction.guild.id, // @everyone
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: user.id, // Şikayet açan üye
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: client.user.id, // Bot
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.EmbedLinks
          ]
        }
      ];

      // Üst yönetim rolleri (Kurucu, Yönetici, Yetkili Sorumlusu)
      const managerRoleIds = ['1557456821516640356', '1557808009437118495', '1561012325627076658'];
      for (const rId of managerRoleIds) {
        if (interaction.guild.roles.cache.has(rId)) {
          overwrites.push({
            id: rId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks
            ]
          });
        }
      }

      const ticketChannel = await interaction.guild.channels.create({
        name: ticketChannelName,
        type: ChannelType.GuildText,
        parent: interaction.channel.parentId || null,
        topic: `Yetkili Şikayet Talebi | Açan: ${user.tag} (${user.id})`,
        permissionOverwrites: overwrites
      });

      const welcomeEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('<:Growpedia:1561556279225225236> Yetkili Şikayet Talebi')
        .setDescription(
          `Selam ${member}! Yetkili şikayet talebin açıldı.\n\n` +
          `<:gttrright:1537943550069706792> Lütfen aşağıda tek tek iletilen soruları bu kanala eksiksiz bir şekilde yanıtlayınız.\n` +
          `<:gttrwarn:1537943562111680623> Bu kanal yalnızca sen ve üst yönetim tarafından görülebilir.\n\n` +
          `Talebi kapatmak istediğinde aşağıdaki **Talebi Kapat** butonuna tıklayabilirsin.`
        )
        .setFooter({ text: `${interaction.guild.name} • Şikayet Sistemi` })
        .setTimestamp();

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_ticket_close')
          .setLabel('Talebi Kapat')
          .setEmoji('1537945026611519529')
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${member} <@&1557456821516640356> <@&1557808009437118495> <@&1561012325627076658>`,
        embeds: [welcomeEmbed],
        components: [closeRow]
      });

      // Soruları tek tek mesaj olarak gönder
      const complaintQuestions = [
        `**1. Şikâyet Edilen Yetkili**\n> Şikâyet etmek istediğin yetkilinin Discord kullanıcı adını veya sunucudaki rolünü belirt.`,
        `**2. Şikâyet Sebebi**\n> Yetkiliyi hangi sebeple şikâyet ediyorsun? Şikâyet nedenini açık ve anlaşılır bir şekilde belirt.`,
        `**3. Olayın Açıklaması**\n> Yaşanan olayı detaylı bir şekilde anlat. Ne olduğunu, nerede gerçekleştiğini ve varsa olaya dahil olan diğer kişileri belirt.`,
        `**4. Olayın Tarihi**\n> Olayın hangi tarihte ve yaklaşık hangi saatte gerçekleştiğini belirt.`,
        `**5. Kanıtlar**\n> Varsa ekran görüntülerini, mesaj bağlantılarını veya diğer destekleyici kanıtları paylaş. Kanıtın yoksa bunu belirt.`
      ];

      for (const q of complaintQuestions) {
        await ticketChannel.send({
          content: `<:gttrright:1537943550069706792> ${q}`
        });
      }

      return interaction.editReply({
        content: `<:gttryes:1537945024203849850> Şikayet talebiniz başarıyla oluşturuldu: ${ticketChannel}`
      });
    }

    // 2. TICKET KAPATMA BUTONU (TRANSKRİPT OLUŞTUR VE LOG KANALINA AT)
    if (interaction.isButton() && interaction.customId === 'btn_ticket_close') {
      await interaction.deferReply({ flags: 64 });

      // Mesajları çek ve transkript hazırla
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const sortedMessages = Array.from(messages.values()).reverse();

      let transcriptText = `====================================================\n`;
      transcriptText += `GROWTOPIA TÜRKİYE - YETKİLİ ŞİKAYET TRANSKRİPTİ\n`;
      transcriptText += `Kanal: #${interaction.channel.name}\n`;
      transcriptText += `Kapatan: ${interaction.user.tag} (${interaction.user.id})\n`;
      transcriptText += `Tarih: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}\n`;
      transcriptText += `Toplam Mesaj: ${sortedMessages.length}\n`;
      transcriptText += `====================================================\n\n`;

      for (const msg of sortedMessages) {
        const time = new Date(msg.createdTimestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        const author = `${msg.author.tag} (${msg.author.id})`;
        const content = msg.content || (msg.embeds.length > 0 ? '[Embed Mesajı]' : '[İçerik yok]');
        transcriptText += `[${time}] ${author}:\n${content}\n`;
        if (msg.attachments.size > 0) {
          msg.attachments.forEach(att => {
            transcriptText += `   [Ek Dosya / Resim]: ${att.url}\n`;
          });
        }
        transcriptText += `\n`;
      }

      const attachment = new AttachmentBuilder(Buffer.from(transcriptText, 'utf-8'), {
        name: `transkript-${interaction.channel.name}.txt`
      });

      // Transkript log kanalına gönder (1561884749562118217)
      const logChannelId = config.channels.ticketLog || '1561884749562118217';
      let logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (!logChannel) {
        logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
      }

      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('<:Growpedia:1561556279225225236> Şikayet Talebi Transkripti')
          .setDescription(
            `📁 **Kanal:** \`#${interaction.channel.name}\`\n` +
            `👤 **Kapatan:** ${interaction.member} (\`${interaction.user.id}\`)\n` +
            `📅 **Kapanış Zamanı:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
            `💬 **Toplam Mesaj:** \`${sortedMessages.length}\` adet\n\n` +
            `<:gttrright:1537943550069706792> Tüm görüşme dökümü ekteki dosyada güvenle arşivlendi.`
          )
          .setFooter({ text: `${interaction.guild.name} • Ticket Arşivi` })
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed], files: [attachment] }).catch(err => {
          console.error('Transkript log kanalına atılamadı:', err.message);
        });
      }

      // Şikayet açan üyenin yazma iznini kapat
      const ticketCreatorId = interaction.channel.topic?.match(/\((\d{17,20})\)/)?.[1];
      if (ticketCreatorId) {
        await interaction.channel.permissionOverwrites.edit(ticketCreatorId, {
          SendMessages: false
        }).catch(() => {});
      }

      // Kapatıldı ve Yetkili İçin Silme Butonu Gönder
      const closedEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('<:Growpedia:1561556279225225236> Talep Kapatıldı & Arşivlendi')
        .setDescription(
          `Bu şikayet talebi ${interaction.member} tarafından kapatıldı.\n\n` +
          `<:gttryes:1537945024203849850> Konuşma transkripti <#${logChannelId}> kanalına başarıyla kaydedildi.\n\n` +
          `<:gttrwarn:1537943562111680623> Bir yetkili aşağıdaki butona bastığında bu kanal **tamamıyla silinecektir**.`
        )
        .setFooter({ text: `${interaction.guild.name} • Şikayet Sistemi` })
        .setTimestamp();

      const deleteRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_ticket_delete')
          .setLabel('Kanalı Tamamıyla Sil')
          .setEmoji('1537945026611519529')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.channel.send({ embeds: [closedEmbed], components: [deleteRow] });
      return interaction.editReply({ content: '<:gttryes:1537945024203849850> Talep kapatıldı ve transkript arşivlendi.' });
    }

    // 3. KANALI TAMAMIYLA SİL BUTONU (YALNIZCA YETKİLİLER)
    if (interaction.isButton() && interaction.customId === 'btn_ticket_delete') {
      const staffMember = interaction.member;
      const isStaff = staffMember.permissions.has(PermissionFlagsBits.Administrator) ||
        staffMember.roles.cache.some(r => r.name.toLowerCase().includes('yetkili') || ['1557456821516640356', '1557808009437118495', '1561012325627076658'].includes(r.id));

      if (!isStaff) {
        return interaction.reply({
          content: '<:gttrwarn:1537943562111680623> Bu kanalı yalnızca yetkili ekibi tamamıyla silebilir!',
          flags: 64
        });
      }

      const deletingEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setDescription(`<:gttrwarn:1537943562111680623> Kanal ${interaction.member} tarafından siliniyor... (3 saniye)`);

      await interaction.update({ embeds: [deletingEmbed], components: [] }).catch(() => {});

      setTimeout(async () => {
        await interaction.channel.delete().catch(() => {});
      }, 3000);
      return;
    }

  } catch (error) {
    console.error('Etkileşim (interaction) hatası:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'İşlem gerçekleştirilirken bir hata oluştu.', flags: 64 }).catch(() => {});
    }
  }
});

// Botu başlat
client.login(config.token).catch(err => {
  console.error('Bot giriş yaparken hata aldı:', err.message);
});
