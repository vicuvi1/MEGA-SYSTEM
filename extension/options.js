const input = document.getElementById('token')
chrome.storage.local.get('token').then(({ token }) => (input.value = token || ''))
document.getElementById('save').onclick = async () => {
  await chrome.storage.local.set({ token: input.value.trim() })
  document.getElementById('msg').textContent = 'Saved. Sites on your list are kept away while a focus timer runs.'
}
