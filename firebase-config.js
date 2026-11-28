/* Pharos — Google ile giriş ayarı.
   Bu değerler gizli değildir; güvenliği Firestore kuralları ve
   Authentication > Authorized domains ayarı sağlar. */
window.KA_FIREBASE = {
  apiKey: "AIzaSyBDPREJZQzhjoTbGghbxSUy77cX7pWwrBQ",
  // Giriş sayfası sitenin kendi adresinden açılır (vercel.json /__/auth yönlendirmesi). iPhone ve uygulama modunda girişin çalışması için gerekli.
  authDomain: location.hostname === "kelime-arenasi-d8zm.vercel.app" ? "kelime-arenasi-d8zm.vercel.app" : "kelime-arenasi-d15cb.firebaseapp.com",
  projectId: "kelime-arenasi-d15cb",
  storageBucket: "kelime-arenasi-d15cb.firebasestorage.app",
  messagingSenderId: "435899196018",
  appId: "1:435899196018:web:1e2f986d2504dca97a98eb"
};
