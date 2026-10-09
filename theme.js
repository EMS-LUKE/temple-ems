// 外觀設定：預設深色，可切換淺色。在畫面出現前先套用，避免閃一下
(function(){var t="dark";try{if(JSON.parse(localStorage.getItem("ems.theme")||'""')==="light")t="light"}catch(e){}document.documentElement.setAttribute("data-theme",t)})();
