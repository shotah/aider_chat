import * as vscode from 'vscode';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiderAgent.chatView';

    private view?: vscode.WebviewView;
    private pendingMessages: Array<{ type: string; text?: string }> = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly onSend: (text: string) => void,
        private readonly onAction?: (action: string, value?: string) => void,
    ) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;

        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((msg) => {
            if (msg.command === 'send') {
                this.onSend(msg.text);
            } else if (msg.command === 'action') {
                this.onAction?.(msg.action, msg.value);
            }
        });

        for (const m of this.pendingMessages) {
            webviewView.webview.postMessage(m);
        }
        this.pendingMessages = [];
    }

    // ── Public API called by extension.ts ────────────────────────────

    public addUserMessage(text: string): void {
        this.post({ type: 'userMessage', text });
    }

    public appendAiChunk(text: string): void {
        this.post({ type: 'aiChunk', text });
    }

    public markAiDone(): void {
        this.post({ type: 'aiDone' });
    }

    public showStatus(text: string): void {
        this.post({ type: 'status', text });
    }

    public showThinking(visible: boolean): void {
        this.post({ type: 'thinking', text: visible ? 'show' : 'hide' });
    }

    public setProvider(provider: string): void {
        this.post({ type: 'provider', text: provider });
    }

    public clear(): void {
        this.post({ type: 'clear' });
    }

    // ── Internals ────────────────────────────────────────────────────

    private post(msg: { type: string; text?: string }): void {
        if (this.view) {
            this.view.webview.postMessage(msg);
        } else {
            this.pendingMessages.push(msg);
        }
    }

    private buildHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{
  display:flex;flex-direction:column;
  background:var(--vscode-editor-background);
  color:var(--vscode-editor-foreground);
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-editor-font-size,13px);
}

#messages{
  flex:1;overflow-y:auto;padding:10px 12px;
  display:flex;flex-direction:column;gap:8px;
}

.msg{
  padding:8px 12px;border-radius:8px;
  white-space:pre-wrap;word-wrap:break-word;
  line-height:1.45;max-width:92%;
  font-family:var(--vscode-editor-font-family);
  font-size:var(--vscode-editor-font-size,13px);
}
.msg.user{
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
  align-self:flex-end;border-bottom-right-radius:2px;
}
.msg.ai{
  background:var(--vscode-editor-inactiveSelectionBackground);
  align-self:flex-start;border-bottom-left-radius:2px;
}
.msg.status{
  align-self:center;text-align:center;
  color:var(--vscode-descriptionForeground);
  font-style:italic;background:none;
  padding:4px 0;
}

#thinking{
  align-self:flex-start;padding:8px 12px;
  color:var(--vscode-descriptionForeground);
  font-style:italic;display:none;
}
#thinking.visible{display:flex;align-items:center;gap:6px}
.dot-pulse{display:flex;gap:3px}
.dot-pulse span{
  width:5px;height:5px;border-radius:50%;
  background:var(--vscode-descriptionForeground);
  animation:bounce 1.4s ease-in-out infinite;
}
.dot-pulse span:nth-child(2){animation-delay:0.2s}
.dot-pulse span:nth-child(3){animation-delay:0.4s}
@keyframes bounce{0%,80%,100%{opacity:.25;transform:scale(0.8)}40%{opacity:1;transform:scale(1.1)}}

#input-area{
  display:flex;gap:6px;padding:8px 10px;
  border-top:1px solid var(--vscode-panel-border);
  background:var(--vscode-sideBar-background);
}
#input{
  flex:1;padding:7px 10px;
  border:1px solid var(--vscode-input-border);
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  font-family:var(--vscode-editor-font-family);
  font-size:var(--vscode-editor-font-size,13px);
  border-radius:4px;resize:none;
  min-height:34px;max-height:120px;
}
#input:focus{outline:1px solid var(--vscode-focusBorder)}
.action-btn{
  padding:6px 12px;align-self:flex-end;
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
  border:none;border-radius:4px;cursor:pointer;
  font-size:var(--vscode-editor-font-size,13px);
}
.action-btn:hover{background:var(--vscode-button-hoverBackground)}
#attach-btn{
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
}
#attach-btn:hover{background:var(--vscode-button-secondaryHoverBackground)}

#provider-bar{
  display:flex;align-items:center;gap:8px;
  padding:6px 12px;
  border-bottom:1px solid var(--vscode-panel-border);
  background:var(--vscode-sideBar-background);
  font-size:12px;
}
#provider-bar label{
  color:var(--vscode-descriptionForeground);
  white-space:nowrap;
}
#provider-select{
  flex:1;max-width:140px;padding:3px 6px;
  border:1px solid var(--vscode-input-border);
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  font-family:var(--vscode-font-family);
  font-size:12px;border-radius:3px;
}
#provider-select:focus{outline:1px solid var(--vscode-focusBorder)}
</style>
</head>
<body>
<div id="provider-bar">
  <label for="provider-select">Driven by:</label>
  <select id="provider-select">
    <option value="local">Local (Ollama)</option>
    <option value="remote">Remote (Claude API)</option>
  </select>
</div>
<div id="messages">
  <div class="msg status">Start the engine to chat with Aider.</div>
</div>
<div id="thinking">
  <div class="dot-pulse"><span></span><span></span><span></span></div>
  Processing…
</div>
<div id="input-area">
  <button id="attach-btn" class="action-btn" title="Add files to Aider context">+</button>
  <textarea id="input" placeholder="Ask Aider…" rows="1"></textarea>
  <button id="send-btn" class="action-btn">Send</button>
</div>

<script nonce="${nonce}">
(function(){
  const vscode=acquireVsCodeApi();
  const messagesEl=document.getElementById('messages');
  const inputEl=document.getElementById('input');
  const sendBtn=document.getElementById('send-btn');
  const attachBtn=document.getElementById('attach-btn');
  const thinkingEl=document.getElementById('thinking');
  const providerSelect=document.getElementById('provider-select');

  let currentAiEl=null;

  function scrollBottom(){messagesEl.scrollTop=messagesEl.scrollHeight}

  function addBubble(cls,text){
    const d=document.createElement('div');
    d.className='msg '+cls;
    d.textContent=text;
    messagesEl.appendChild(d);
    scrollBottom();
    return d;
  }

  function send(){
    const text=inputEl.value.trim();
    if(!text)return;
    inputEl.value='';
    inputEl.style.height='auto';
    vscode.postMessage({command:'send',text:text});
  }

  sendBtn.addEventListener('click',send);
  attachBtn.addEventListener('click',function(){
    vscode.postMessage({command:'action',action:'pickFiles'});
  });
  providerSelect.addEventListener('change',function(){
    vscode.postMessage({command:'action',action:'switchProvider',value:providerSelect.value});
  });
  inputEl.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
  });
  inputEl.addEventListener('input',function(){
    inputEl.style.height='auto';
    inputEl.style.height=Math.min(inputEl.scrollHeight,120)+'px';
  });

  window.addEventListener('message',function(ev){
    var m=ev.data;
    switch(m.type){
      case 'userMessage':
        addBubble('user',m.text);
        currentAiEl=null;
        break;
      case 'aiChunk':
        if(!currentAiEl){currentAiEl=addBubble('ai','')}
        currentAiEl.textContent+=m.text;
        scrollBottom();
        break;
      case 'aiDone':
        if(currentAiEl){currentAiEl.classList.remove('thinking')}
        currentAiEl=null;
        break;
      case 'status':
        addBubble('status',m.text);
        break;
      case 'thinking':
        thinkingEl.className=m.text==='show'?'visible':'';
        scrollBottom();
        break;
      case 'provider':
        providerSelect.value=m.text;
        break;
      case 'clear':
        messagesEl.innerHTML='';
        currentAiEl=null;
        thinkingEl.className='';
        break;
    }
  });
})();
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
