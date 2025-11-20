document.getElementById("formatButton").addEventListener("click", () => {
  const macInput = document.getElementById("macInput").value;
  const formattedMAC = macInput.replace(/.{2}(?=.)/g, "$&-");
  document.getElementById("result").innerText = formattedMAC;
  
  chrome.runtime.sendMessage({ action: "copyFromStorage" }, (response) => {
    if (response.success) {
      alert("MAC 주소가 복사되었습니다!");
    } else {
      alert("복사 실패: " + response.error);
    }
  });
  
});
