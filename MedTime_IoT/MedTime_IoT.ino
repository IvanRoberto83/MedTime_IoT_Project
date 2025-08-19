#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <SoftwareSerial.h>
#include <DFRobotDFPlayerMini.h>

// WiFi
const char *ssid = //nama wifi;
const char *password = //password wifi;

// MQTT Broker
const char *mqtt_broker = "test.mosquitto.org";
const char *topic = "pkm/alarm";
const char *mqtt_username = "";
const char *mqtt_password = "";
const int mqtt_port = 1883;

// Pin
#define LED_PIN 14 // D5
#define DF_TX 5    // D1 ke RX DFPlayer
#define DF_RX 4    // D2 ke TX DFPlayer

WiFiClient espClient;
PubSubClient client(espClient);

// DFPlayer
SoftwareSerial dfSerial(DF_RX, DF_TX); // RX, TX (ESP8266 menerima di RX)
DFRobotDFPlayerMini dfPlayer;

bool ledState = false;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  Serial.begin(9600);

  // Serial DFPlayer
  dfSerial.begin(9600);
  if (!dfPlayer.begin(dfSerial)) {
    Serial.println("❌ Gagal inisialisasi DFPlayer!");
  } else {
    Serial.println("✅ DFPlayer siap!");
    dfPlayer.volume(30); // ini buat ngatur volume (0-30)
  }

  // Koneksi WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.println("🔌 Connecting to WiFi...");
  }
  Serial.println("✅ Connected to WiFi!");

  // Koneksi MQTT
  client.setServer(mqtt_broker, mqtt_port);
  client.setCallback(callback);
  while (!client.connected()) {
    String client_id = "esp8266-client-" + String(WiFi.macAddress());
    Serial.printf("📡 Connecting to MQTT Broker: %s\n", client_id.c_str());
    if (client.connect(client_id.c_str(), mqtt_username, mqtt_password)) {
      Serial.println("✅ Connected to MQTT Broker!");
    } else {
      Serial.print("❌ Failed, rc=");
      Serial.print(client.state());
      Serial.println(" retrying in 2 seconds...");
      delay(2000);
    }
  }

  client.publish(topic, "📨 ESP Ready & Subscribed!");
  client.subscribe(topic);
}

void callback(char *topic, byte *payload, unsigned int length) {
  Serial.print("📩 Message arrived in topic: ");
  Serial.println(topic);

  String msg = "";
  for (int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  Serial.print("💬 Message: ");
  Serial.println(msg);
  Serial.println("-----------------------");

  if (String(topic) == "pkm/alarm") {
    if (msg.indexOf("\"command\":\"ON\"") >= 0) {
      ledState = true;
      digitalWrite(LED_PIN, HIGH);
      Serial.println("💡 LED ON");
      dfPlayer.play(1); // mainkan 0001.mp3
    } else if (msg.indexOf("\"command\":\"OFF\"") >= 0) {
      ledState = false;
      digitalWrite(LED_PIN, LOW);
      Serial.println("💤 LED OFF");
      dfPlayer.stop();
    }
  }
}

void loop() {
  client.loop();
}