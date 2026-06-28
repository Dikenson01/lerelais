/* eslint-disable */
"use client";

import { useState, useEffect } from "react";
import { Smartphone, Plus, Trash2, Loader2, RefreshCw } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useSocket } from "@/lib/socket";

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const { socket } = useSocket();

  useEffect(() => {
    fetchApi("/auth/me").then(user => setOrgId(user.orgId)).catch(console.error);
    loadAccounts();
    
    if (socket) {
      socket.on("qr_code", (payload) => {
        setQrCode(payload.qrCode);
      });
      
      socket.on("connection_update", (payload) => {
        loadAccounts(); // Refresh on status change
      });
    }
    
    return () => {
      if (socket) {
        socket.off("qr_code");
        socket.off("connection_update");
      }
    };
  }, [socket]);

  const loadAccounts = async () => {
    try {
      const data = await fetchApi("/accounts");
      setAccounts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addAccount = async () => {
    try {
      setLoading(true);
      await fetchApi("/accounts", {
        method: "POST",
        body: JSON.stringify({
          platform: "whatsapp",
          accountName: "WhatsApp Principal",
          // Use fetched orgId or fallback to default
          orgId: orgId || "00000000-0000-0000-0000-000000000000"
        })
      });
      loadAccounts();
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const deleteAccount = async (id: string) => {
    try {
      await fetchApi(`/accounts/${id}`, { method: "DELETE" });
      loadAccounts();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto overflow-x-hidden max-w-full w-full">
      <div className="max-w-4xl mx-auto w-full">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 md:mb-8">Settings</h1>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center">
              <Smartphone className="w-5 h-5 mr-2 text-blue-600" />
              Connected Channels
            </h2>
            <button 
              onClick={addAccount}
              className="flex items-center text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add WhatsApp
            </button>
          </div>
          
          <div className="p-6">
            {loading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <p>No accounts connected yet.</p>
              </div>
            ) : (
              <ul className="space-y-4">
                {accounts.map(acc => (
                  <li key={acc.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-blue-300 transition">
                    <div>
                      <h3 className="font-semibold text-slate-900">{acc.accountName || acc.platform}</h3>
                      <div className="flex items-center mt-1">
                        <span className={`w-2 h-2 rounded-full mr-2 ${acc.status === 'connected' ? 'bg-emerald-500' : acc.status === 'pairing' ? 'bg-amber-500' : 'bg-slate-400'}`}></span>
                        <span className="text-sm text-slate-600 capitalize">{acc.status}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      {acc.status === 'pairing' && qrCode && (
                        <div className="mr-4">
                          <img src={qrCode} alt="WhatsApp QR Code" className="w-32 h-32 border border-slate-200 rounded-lg" />
                          <p className="text-xs text-center mt-1 text-slate-500">Scan to connect</p>
                        </div>
                      )}
                      
                      <button 
                        onClick={() => loadAccounts()}
                        className="p-2 text-slate-400 hover:text-slate-600 transition"
                      >
                        <RefreshCw className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => deleteAccount(acc.id)}
                        className="p-2 text-red-400 hover:text-red-600 transition"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
