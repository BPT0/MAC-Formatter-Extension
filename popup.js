document.getElementById("formatButton").addEventListener("click", () => {
  const macInput = document.getElementById("macInput").value;
  const formattedMAC = macInput.replace(/.{2}(?=.)/g, "$&-");
  document.getElementById("result").innerText = formattedMAC;
});
