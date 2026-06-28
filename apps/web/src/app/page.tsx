/* eslint-disable */
"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Filter, MoreVertical, Send, Paperclip, Smile, MessageSquare } from "lucide-react";
import { clsx } from "clsx";
import { fetchApi } from "@/lib/api";
import { useSocket } from "@/lib/socket";

export default function InboxPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const { socket } = useSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
    if (socket) {
      socket.on("new_message", (msg) => {
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === msg.conversationId);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx].lastMessagePreview = msg.content;
            copy[idx].updatedAt = msg.timestamp;
            return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          }
          return prev; // Or trigger reload if completely new
        });

        if (activeId === msg.conversationId) {
          setMessages(prev => [...prev, msg]);
        }
      });
    }
    return () => {
      if (socket) socket.off("new_message");
    };
  }, [socket, activeId]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
  }, [activeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadConversations = async () => {
    try {
      const data = await fetchApi("/conversations");
      setConversations(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadMessages = async (convId: string) => {
    try {
      const data = await fetchApi(`/messages/${convId}`);
      setMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || !activeId) return;
    try {
      const text = inputText;
      setInputText("");
      await fetchApi("/messages/send", {
        method: "POST",
        body: JSON.stringify({
          conversationId: activeId,
          content: text
        })
      });
      // the new message should arrive via websocket!
    } catch (err) {
      console.error(err);
    }
  };

  const activeChat = conversations.find(c => c.id === activeId);

  return (
    <div className="flex-1 flex h-full min-w-0">
      {/* Inbox List */}
      <div className={clsx(
        "w-full md:w-80 border-r border-slate-200 bg-white flex-col flex-shrink-0",
        activeId ? "hidden md:flex" : "flex"
      )}>
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-slate-900">Inbox</h1>
            <button className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
              <Filter className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              className="w-full pl-10 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-sm">No conversations found</div>
          ) : conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveId(conv.id)}
              className={clsx(
                "w-full text-left px-4 py-3 border-b border-slate-100 transition-colors flex flex-col",
                activeId === conv.id ? "bg-blue-50" : "hover:bg-slate-50"
              )}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="font-semibold text-slate-900 truncate pr-2">{conv.contact?.displayName || conv.externalConversationId}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {new Date(conv.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
              <div className="flex items-center justify-between w-full">
                <span className="text-sm text-slate-600 truncate">{conv.lastMessagePreview}</span>
                {conv.platform === 'whatsapp' && (
                   <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] uppercase font-bold">WA</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className={clsx(
        "flex-1 flex-col bg-slate-50/50 min-w-0",
        activeId ? "flex" : "hidden md:flex"
      )}>
        {activeChat ? (
          <>
            {/* Chat Header */}
            <header className="h-16 px-4 md:px-6 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center">
                <button 
                  onClick={() => setActiveId(null)}
                  className="md:hidden mr-2 p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold mr-3 uppercase">
                  {(activeChat.contact?.displayName || '?').charAt(0)}
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">{activeChat.contact?.displayName || activeChat.externalConversationId}</h2>
                  <p className="text-xs text-slate-500 flex items-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>
                    {activeChat.platform}
                  </p>
                </div>
              </div>
              <button className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
                <MoreVertical className="w-5 h-5" />
              </button>
            </header>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((msg, idx) => {
                const isMe = msg.isFromMe;
                return (
                  <div key={msg.id || idx} className={clsx("flex max-w-[80%] items-end", isMe ? "ml-auto justify-end" : "justify-start")}>
                    {!isMe && <div className="w-8 h-8 rounded-full bg-slate-200 flex-shrink-0 mr-3"></div>}
                    <div className={clsx(
                      "p-3 rounded-2xl shadow-sm",
                      isMe ? "bg-blue-600 text-white rounded-br-sm" : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                    )}>
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <span className={clsx("text-[10px] mt-1 block", isMe ? "text-blue-200 text-right" : "text-slate-400")}>
                        {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 bg-white border-t border-slate-200">
              <div className="flex items-end bg-slate-100 rounded-2xl border border-slate-200 p-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
                <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0">
                  <Paperclip className="w-5 h-5" />
                </button>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Écrivez un message..."
                  className="flex-1 max-h-32 min-h-[40px] bg-transparent resize-none outline-none py-2 px-2 text-slate-800"
                  rows={1}
                />
                <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0">
                  <Smile className="w-5 h-5" />
                </button>
                <button 
                  onClick={sendMessage}
                  className={clsx(
                    "p-2 rounded-xl flex-shrink-0 ml-1 transition-colors",
                    inputText.trim() ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  )}
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <MessageSquare className="w-16 h-16 mb-4 text-slate-300" />
            <p className="text-lg">Sélectionnez une conversation pour commencer</p>
          </div>
        )}
      </div>
    </div>
  );
}
