/* eslint-disable */
"use client";

import { useState, useEffect } from "react";
import { Megaphone, Plus, Play, Pause, List, CheckCircle, Loader2 } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { clsx } from "clsx";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  
  const [newCampaign, setNewCampaign] = useState({
    name: "",
    listId: "",
    messageTemplate: "Bonjour {nom}, {variations|spintax} ?",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [camps, lts] = await Promise.all([
        fetchApi("/campaigns"),
        fetchApi("/campaigns/lists")
      ]);
      setCampaigns(camps);
      setLists(lts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const createCampaign = async () => {
    try {
      await fetchApi("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          ...newCampaign,
          orgId: "00000000-0000-0000-0000-000000000000",
        })
      });
      setShowCreate(false);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const startCampaign = async (id: string) => {
    try {
      await fetchApi(`/campaigns/${id}/start`, { method: "POST" });
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 flex items-center">
            <Megaphone className="w-8 h-8 mr-3 text-blue-600" />
            Campagnes
          </h1>
          <button 
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm font-medium"
          >
            <Plus className="w-5 h-5 mr-2" />
            Nouvelle Campagne
          </button>
        </div>

        {showCreate && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8 animate-in fade-in slide-in-from-top-4">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Créer une campagne</h2>
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nom de la campagne</label>
                <input 
                  type="text" 
                  value={newCampaign.name}
                  onChange={e => setNewCampaign({...newCampaign, name: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  placeholder="Ex: Relance prospects Hiver 2026"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Liste de diffusion</label>
                <select 
                  value={newCampaign.listId}
                  onChange={e => setNewCampaign({...newCampaign, listId: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sélectionner une liste...</option>
                  {lists.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-1">Message (Template Spintax supporté)</label>
              <textarea 
                value={newCampaign.messageTemplate}
                onChange={e => setNewCampaign({...newCampaign, messageTemplate: e.target.value})}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]" 
              />
              <p className="text-xs text-slate-500 mt-2">Utilisez `{'{'}nom{'}'}` pour personnaliser et `{'{'}bonjour|salut{'}'}` pour générer des variations (Spintax).</p>
            </div>
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition"
              >
                Annuler
              </button>
              <button 
                onClick={createCampaign}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                disabled={!newCampaign.name || !newCampaign.listId}
              >
                Créer la campagne
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-500 uppercase tracking-wider">
                  <th className="p-4">Nom de la campagne</th>
                  <th className="p-4">Statut</th>
                  <th className="p-4">Progression</th>
                  <th className="p-4">Création</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">Aucune campagne créée.</td>
                  </tr>
                ) : campaigns.map(camp => (
                  <tr key={camp.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-medium text-slate-900">{camp.name}</td>
                    <td className="p-4">
                      <span className={clsx(
                        "px-2.5 py-1 rounded-full text-xs font-medium capitalize flex inline-flex items-center",
                        camp.status === 'draft' ? "bg-slate-100 text-slate-700" :
                        camp.status === 'running' ? "bg-blue-100 text-blue-700" :
                        "bg-emerald-100 text-emerald-700"
                      )}>
                        {camp.status === 'running' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                        {camp.status === 'completed' && <CheckCircle className="w-3 h-3 mr-1" />}
                        {camp.status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="w-full max-w-[200px]">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>{camp.stats?.sent || 0} envoyés</span>
                          <span>{camp.stats?.failed || 0} erreurs</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: '0%' }}></div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      {new Date(camp.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      {camp.status === 'draft' && (
                        <button 
                          onClick={() => startCampaign(camp.id)}
                          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                          title="Lancer la campagne"
                        >
                          <Play className="w-5 h-5" />
                        </button>
                      )}
                      {camp.status === 'running' && (
                        <button 
                          className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition"
                          title="Mettre en pause"
                        >
                          <Pause className="w-5 h-5" />
                        </button>
                      )}
                      <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition ml-2">
                        <List className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
