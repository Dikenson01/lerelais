"use client";

import { useState, useEffect } from "react";
import { Users, Upload, Search, Filter, Plus, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { fetchApi } from "@/lib/api";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      setLoading(true);
      const data = await fetchApi("/contacts");
      setContacts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const parseCsvAndImport = async () => {
    try {
      setImportStatus("Importation en cours...");
      
      const lines = importText.split('\n').filter(l => l.trim().length > 0);
      const newContacts = lines.map(line => {
        // Very basic parsing: Name, Phone
        const parts = line.split(',');
        return {
          displayName: parts[0]?.trim() || "Inconnu",
          phoneNumber: parts[1]?.trim() || "",
          orgId: "00000000-0000-0000-0000-000000000000" // Default org
        };
      }).filter(c => c.phoneNumber.length > 5);

      if (newContacts.length === 0) {
        setImportStatus("Erreur: Aucun contact valide trouvé (format attendu: Nom,Numéro).");
        return;
      }

      // In a real app we'd do a batch insert, for now one by one or create a batch route
      for (const contact of newContacts) {
        await fetchApi("/contacts", {
          method: "POST",
          body: JSON.stringify(contact)
        });
      }

      setImportStatus(`Succès: ${newContacts.length} contacts importés.`);
      setImportText("");
      setTimeout(() => setShowImport(false), 2000);
      loadContacts();
    } catch (err) {
      console.error(err);
      setImportStatus("Erreur lors de l'importation.");
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 flex items-center">
            <Users className="w-8 h-8 mr-3 text-blue-600" />
            Contacts
          </h1>
          <div className="flex space-x-3">
            <button 
              onClick={() => setShowImport(!showImport)}
              className="flex items-center px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition font-medium"
            >
              <Upload className="w-5 h-5 mr-2" />
              Importer CSV
            </button>
            <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm font-medium">
              <Plus className="w-5 h-5 mr-2" />
              Nouveau Contact
            </button>
          </div>
        </div>

        {showImport && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8 animate-in fade-in slide-in-from-top-4">
            <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2 text-slate-400" />
              Import CSV Rapide
            </h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Collez vos données CSV (Format: Nom,Numéro)
              </label>
              <textarea 
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={"Jean Dupont,+33612345678\nMarie Martin,0785790191"}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm min-h-[150px]"
              />
            </div>
            
            {importStatus && (
              <div className={`mb-4 p-3 rounded-lg text-sm flex items-center ${
                importStatus.includes('Succès') ? 'bg-emerald-50 text-emerald-700' :
                importStatus.includes('Erreur') ? 'bg-red-50 text-red-700' :
                'bg-blue-50 text-blue-700'
              }`}>
                {importStatus.includes('Succès') ? <CheckCircle className="w-4 h-4 mr-2" /> :
                 importStatus.includes('Erreur') ? <AlertCircle className="w-4 h-4 mr-2" /> :
                 <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mr-2" />}
                {importStatus}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setShowImport(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition"
              >
                Annuler
              </button>
              <button 
                onClick={parseCsvAndImport}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                disabled={!importText.trim()}
              >
                Importer
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <div className="relative w-64">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher un contact..."
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
              <Filter className="w-5 h-5" />
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-sm font-medium text-slate-500 uppercase tracking-wider bg-white">
                  <th className="p-4">Nom</th>
                  <th className="p-4">Numéro de téléphone</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Tags</th>
                  <th className="p-4 text-right">Dernier message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contacts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      Aucun contact trouvé. Importez-en pour commencer !
                    </td>
                  </tr>
                ) : contacts.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50 transition cursor-pointer">
                    <td className="p-4">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold mr-3 uppercase">
                          {(c.displayName || '?').charAt(0)}
                        </div>
                        <span className="font-medium text-slate-900">{c.displayName}</span>
                      </div>
                    </td>
                    <td className="p-4 text-slate-600">{c.phoneNumber || '-'}</td>
                    <td className="p-4 text-slate-600">{c.email || '-'}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Client</span>
                    </td>
                    <td className="p-4 text-right text-slate-500 text-sm">
                      {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString() : 'Jamais'}
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
