// Google ile giriş ayarları (isteğe bağlı)
// Bu dosya boş (null) kaldıkça sitede giriş düğmesi görünmez; her şey şimdiki gibi çalışır.
// Firebase'de projeni açtıktan sonra "firebaseConfig" kutusundaki değerleri aşağıya yapıştır.
// Bu değerler gizli değildir; güvenliği Firestore kuralları ve yetkili alan adları sağlar.
window.KA_FIREBASE = null;
/* ÖRNEK (kendi değerlerinle değiştir, başındaki // işaretlerini değil, yukarıdaki null satırını sil):
window.KA_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "proje-adin.firebaseapp.com",
  projectId: "proje-adin",
  appId: "1:123456789:web:abc123"
};
*/
