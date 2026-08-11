const { Client: SelfClient } = require('discord.js-selfbot-v13');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceName(name, from, to) {
  if (!from || !to) return name;
  const re = new RegExp(escapeRegExp(from), 'gi');
  return String(name).replace(re, to);
}

function calistir(token, sourceId, targetId, fromName, toName, logCallback, durumCallback, bildirimCallback) {
  let iptal = false;

  function log(mesaj, tip = 'bilgi') {
    if (typeof logCallback === 'function') logCallback(mesaj, tip);
  }

  function durum(d) {
    if (typeof durumCallback === 'function') durumCallback(d);
  }

  function bildirim(b) {
    if (typeof bildirimCallback === 'function') bildirimCallback(b);
  }

  function iptalEt() { iptal = true; }

  function iptalSonuc() {
    log('⛔ İşlem durduruldu.', 'uyari');
    return { basarili: false, tag: selfClient.user?.tag || '', rol: 0, kategori: 0, kanal: 0, fatal: 'iptal' };
  }

  const selfClient = new SelfClient({
    checkUpdate: false,
    patchVoice: false,
    ws: { properties: { $os: "Windows", $browser: "Discord Client", $device: "Desktop" } }
  });

  selfClient.on('error', (err) => {
    console.error('[KOPYALA] SelfClient Hatası:', err.message);
  });

  const promise = new Promise((resolve) => {
    (async () => {
      try {
        await selfClient.login(token);
        log('🛰️ Sunucu kopyalama motoru başlatıldı.', 'bilgi');
        durum({ phase: 'hazirlik' });

        const sourceGuild = await selfClient.guilds.fetch(sourceId).catch(() => null);
        const targetGuild = await selfClient.guilds.fetch(targetId).catch(() => null);

        if (!sourceGuild || !targetGuild) {
          const msg = !sourceGuild ? 'Kaynak sunucu bulunamadı.' : 'Hedef sunucu bulunamadı.';
          log(`❌ ${msg}`, 'hata');
          return { basarili: false, tag: selfClient.user?.tag || '', rol: 0, kategori: 0, kanal: 0, errors: 1, fatal: msg };
        }

        log(`📋 Kaynak: ${sourceGuild.name}`, 'bilgi');
        log(`📋 Hedef: ${targetGuild.name}`, 'bilgi');
        durum({ phase: 'temizlik', source: sourceGuild.name, target: targetGuild.name });

        // Safha 1: Hedef sunucuyu sıfırla
        log('🧹 Safha 1: Hedef sunucu sıfırlanıyor (kanallar/roller siliniyor)...', 'bilgi');
        const targetChannels = await targetGuild.channels.fetch();
        for (const ch of targetChannels.values()) {
          if (iptal) break;
          await ch.delete().catch(() => { });
          await sleep(100);
        }
        if (iptal) return iptalSonuc();

        const targetRoles = await targetGuild.roles.fetch();
        for (const role of targetRoles.values()) {
          if (iptal) break;
          if (role.id !== targetGuild.id && role.editable && !role.managed) {
            await role.delete().catch(() => { });
            await sleep(100);
          }
        }
        if (iptal) return iptalSonuc();

        await targetGuild.setName(replaceName(sourceGuild.name, fromName, toName)).catch(() => { });
        const iconUrl = sourceGuild.iconURL({ format: 'png', size: 1024 });
        if (iconUrl) await targetGuild.setIcon(iconUrl).catch(() => { });
        const bannerUrl = sourceGuild.bannerURL({ format: 'png', size: 1024 });
        if (bannerUrl) await targetGuild.setBanner(bannerUrl).catch(() => { });

        // Safha 2: Rol aktarımı
        const roleMap = new Map();
        const sourceRoles = await sourceGuild.roles.fetch();

        const sourceEveryone = sourceRoles.get(sourceGuild.id);
        if (sourceEveryone) {
          await targetGuild.roles.everyone.setPermissions(sourceEveryone.permissions.bitfield).catch(() => { });
          roleMap.set(sourceGuild.id, targetGuild.roles.everyone.id);
        }

        const sortedRoles = sourceRoles
          .filter((r) => r.id !== sourceGuild.id && !r.managed)
          .sort((a, b) => b.position - a.position);

        let roleDone = 0;
        const newRolePositions = [];

        for (const role of sortedRoles.values()) {
          if (iptal) break;
          try {
            const newRole = await targetGuild.roles.create({
              name: replaceName(role.name, fromName, toName),
              colors: [role.color],
              hoist: role.hoist,
              permissions: role.permissions.bitfield,
              mentionable: role.mentionable
            });
            roleMap.set(role.id, newRole.id);
            newRolePositions.push({ role: newRole, position: role.position });

            roleDone++;
            log(`🎭 Rol (${role.position}): ${role.name}`, 'bilgi');
            durum({ phase: 'rol', done: roleDone, total: sortedRoles.size });
            await sleep(300);
          } catch (e) {
            console.error('[KOPYALA] Rol hatası:', e.message);
          }
        }
        if (iptal) return iptalSonuc();

        if (newRolePositions.length > 0) {
          try {
            const sorted = [...newRolePositions].sort((a, b) => b.position - a.position);
            await targetGuild.roles.setPositions(
              sorted.map((p, i) => ({ role: p.role.id, position: sorted.length - i }))
            ).catch(() => { });
          } catch { }
        }

        const mapOverwrites = (overwritesCache) => {
          return overwritesCache.map((ov) => ({
            id: roleMap.get(ov.id) || ov.id,
            allow: ov.allow.bitfield,
            deny: ov.deny.bitfield,
            type: ov.type
          }));
        };

        // Safha 3: Kategori aktarımı
        const categoryMap = new Map();
        const sourceChannels = await sourceGuild.channels.fetch();
        const categories = sourceChannels
          .filter((c) => c.type === 'GUILD_CATEGORY' || c.type === 4)
          .sort((a, b) => a.position - b.position);

        let catDone = 0;
        for (const cat of categories.values()) {
          if (iptal) break;
          try {
            const newCat = await targetGuild.channels.create(replaceName(cat.name, fromName, toName), {
              type: 'GUILD_CATEGORY',
              permissionOverwrites: mapOverwrites(cat.permissionOverwrites.cache),
              position: cat.position
            });
            categoryMap.set(cat.id, newCat.id);

            catDone++;
            log(`📂 Kategori (${catDone}/${categories.size}): ${cat.name}`, 'bilgi');
            durum({ phase: 'kategori', done: catDone, total: categories.size });
            await sleep(200);
          } catch (e) {
            console.error('[KOPYALA] Kategori hatası:', e.message);
          }
        }
        if (iptal) return iptalSonuc();

        // Safha 4: Kanal aktarımı
        const otherChannels = sourceChannels
          .filter((c) => c.type !== 'GUILD_CATEGORY' && c.type !== 4)
          .sort((a, b) => a.position - b.position);

        let chDone = 0;
        for (const ch of otherChannels.values()) {
          if (iptal) break;
          try {
            const tip = ch.type;

            // Thread'ler ve directory kanalları bu uçla oluşturulamaz → atla
            if (['GUILD_NEWS_THREAD', 'GUILD_PUBLIC_THREAD', 'GUILD_PRIVATE_THREAD', 'GUILD_DIRECTORY'].includes(tip)) {
              log(`⚠️ "${ch.name}" (${tip}) oluşturulamadığı için atlandı.`, 'uyari');
              continue;
            }

            // Duyuru kanalları API ile oluşturulamadığı için metin kanalı olarak kopyalanır
            const isDuyuru = tip === 'GUILD_NEWS';

            const options = {
              type: isDuyuru ? 'GUILD_TEXT' : tip,
              parent: categoryMap.get(ch.parentId),
              permissionOverwrites: mapOverwrites(ch.permissionOverwrites.cache),
              position: ch.position
            };

            if (tip === 'GUILD_TEXT' || isDuyuru) {
              options.topic = ch.topic;
              options.nsfw = ch.nsfw;
              options.rateLimitPerUser = ch.rateLimitPerUser;
            } else if (tip === 'GUILD_VOICE' || tip === 'GUILD_STAGE_VOICE') {
              options.bitrate = ch.bitrate;
              options.userLimit = ch.userLimit;
            }

            await targetGuild.channels.create(replaceName(ch.name, fromName, toName), options);

            chDone++;
            log(`💬 Kanal (${chDone}/${otherChannels.size}): ${ch.name}`, 'bilgi');
            durum({ phase: 'kanal', done: chDone, total: otherChannels.size });
            await sleep(200);
          } catch (e) {
            console.error(`[KOPYALA] Kanal hatası (${ch.name}):`, e.message);
          }
        }
        if (iptal) return iptalSonuc();

        log(`✅ Operasyon başarıyla tamamlandı.`, 'basari');
        log(`📊 Rol: ${roleDone} | Kategori: ${catDone} | Kanal: ${chDone}`, 'bilgi');
        durum({ phase: 'bitti', rol: roleDone, kategori: catDone, kanal: chDone });
        bildirim({
          baslik: 'Sunucu Kopyalama Tamamlandı',
          mesaj: `${sourceGuild.name} → ${targetGuild.name} | ${chDone} kanal kopyalandı.`
        });

        return { basarili: true, tag: selfClient.user?.tag || '', rol: roleDone, kategori: catDone, kanal: chDone };
      } catch (err) {
        console.error('[KOPYALA] Fatal Error:', err);
        log(`💥 Kritik hata: ${err.message}`, 'hata');
        return { basarili: false, tag: selfClient.user?.tag || '', rol: 0, kategori: 0, kanal: 0, errors: 1, fatal: err.message };
      } finally {
        try { selfClient.destroy(); } catch { }
      }
    })().then(resolve).catch((err) => {
      console.error('[KOPYALA] Beklenmedik hata:', err);
      resolve({ basarili: false, tag: '', rol: 0, kategori: 0, kanal: 0, errors: 1, fatal: err.message });
    });
  });

  return { promise, iptalEt };
}

module.exports = { calistir };
