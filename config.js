// 設定檔：只需要改這個檔案。
window.EMS_CONFIG = {
  firebase: {
    apiKey: "AIzaSyDmBPvuaduN86YDFJYGbEAw2r6PZFI2NbI",
    authDomain: "temple-ems.firebaseapp.com",
    projectId: "temple-ems",
    storageBucket: "temple-ems.firebasestorage.app",
    messagingSenderId: "787084407688",
    appId: "1:787084407688:web:38021a07336dee86d0c03d"
  },

  // 地圖開啟時的中心點（正統鹿耳門聖母廟）
  center: [23.06802, 120.12724],

  // 分區格線的預設位置：左前角(A1)、右前角(C1)、左後角(A6)。左右以面向廟為準。
  grid: {
    fl: [23.06640, 120.12620],
    fr: [23.06640, 120.12830],
    bl: [23.06920, 120.12620]
  },

  // 底圖最大原生層級。放到最大若底圖變空白，把 19 改成 18。
  maxNativeZoom: 19
};
