const admin = require("firebase-admin");
const mqtt = require("mqtt");
const serviceAccount = require("./pkm-medreminder-firebase-adminsdk-fbsvc-269f52353d.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const client = mqtt.connect("mqtt://test.mosquitto.org:1883");

let remindersData = []; // nyimpen data reminders di memori
let sudahDikirim = new Set(); // nyimpen waktu yang sudah dikirim ke mqtt, biar ga kekirim terus-terusan

// === MQTT Connect ===
client.on("connect", () => {
  console.log("📡 Terhubung ke MQTT broker.");

  // Subscribe realtime dari Firestore
  db.collection("reminders").onSnapshot(async snapshot => {
    // Ngambil data reminder satu-satu dan join dengan banyak lansia & obat
    const dataDenganNama = await Promise.all(snapshot.docs.map(async doc => {
      const data = doc.data();
  
      let namaLansia = [];
      let namaObat = [];
  
      // Ngambil semua nama lansia dari koleksi data 'lansia'
      if (Array.isArray(data.lansiaIds)) {
        for (const lansiaId of data.lansiaIds) {
          const lansiaDoc = await db.collection("lansia").doc(lansiaId).get();
          if (lansiaDoc.exists) {
            namaLansia.push(lansiaDoc.data().nama);
          }
        }
      }
  
      // Ngambil semua nama obat dari koleksi data 'obat'
      if (Array.isArray(data.obatIds)) {
        for (const obatId of data.obatIds) {
          const obatDoc = await db.collection("obat").doc(obatId).get();
          if (obatDoc.exists) {
            namaObat.push(obatDoc.data().nama);
          }
        }
      }
  
      return {
        docId: doc.id, // 🔹 simpan doc.id untuk update
        ...data,
        namaLansia,
        namaObat
      };
    }));
  
    remindersData = dataDenganNama;
    console.log(`📥 Data reminders diperbarui. Jumlah: ${remindersData.length}`);
  });  

  // 🔹 Listener perubahan statusIoT
  db.collection("reminders").onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === "modified") {
        const data = change.doc.data();
        if (data.statusIoT === "OFF") {
          const payload = JSON.stringify({ command: "OFF" });
          client.publish("pkm/alarm", payload, { qos: 1 }, (err) => {
            if (err) {
              console.error("❌ Gagal kirim MQTT OFF:", err);
            } else {
              console.log(`💡 MQTT OFF terkirim untuk reminder ${change.doc.id}`);
            }
          });
        }
      }
    });
  });

  // Timer cek setiap detik (pakai data di memori)
  setInterval(cekAlarm, 1000);
});

// === Fungsi Cek Alarm ===
function cekAlarm() {
  // Buat bandingin jam sekarang dan jam reminder
  const now = new Date();
  const jamSekarang =
    now.getHours().toString().padStart(2, '0') + ':' +
    now.getMinutes().toString().padStart(2, '0');

  // Buat nampilin jam sekarang
  const detailwaktuSekarang =
    now.getHours().toString().padStart(2, '0') + ':' +
    now.getMinutes().toString().padStart(2, '0') + ':' +
    now.getSeconds().toString().padStart(2, '0');

  // Reset flag setiap menit berubah
  if (![...sudahDikirim].includes(jamSekarang)) {
    sudahDikirim.clear();
  }

  console.log("🕒 Sekarang:", detailwaktuSekarang);

  remindersData.forEach(data => {
    // console.log("📄 Data mentah:", data); // nitip, ini buat lihat isi asli data reminder
    // console.log(`🔍 Cek: ${data.waktu}`); // nitip, ini buat lihat semua data waktu di reminder

    if (data.waktu === jamSekarang && !sudahDikirim.has(data.waktu)) {
      console.log("⏰ Waktunya minum obat! Kirim ke MQTT.");

      const payload = JSON.stringify({
        command: "ON",
        pesan: "Waktunya minum obat!",
        lansia: data.namaLansia,
        obat: data.namaObat,
        tanggal: data.tanggal,
        jam: data.waktu
      });

      client.publish("pkm/alarm", payload, { qos: 1 }, async (err) => {
        if (err) {
          console.error("❌ Gagal kirim MQTT:", err);
        } else {
          console.log("✅ MQTT terkirim:", payload);
          sudahDikirim.add(data.waktu); // tandai sudah dikirim ke mqtt

          // update statusIoT di Firestore
          await db.collection("reminders").doc(data.id).update({ statusIoT: "ON" });
          console.log(`🔥 statusIoT reminder ${data.id} diupdate ke ON`);
        }
      });
    }
  });
}
