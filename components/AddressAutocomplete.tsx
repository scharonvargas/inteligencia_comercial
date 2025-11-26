import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Loader2, Globe } from 'lucide-react';

interface AddressAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onLocationSelect?: (lat: number, lng: number) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

interface SuggestionResult {
  place_id: string | number;
  display_name: string;
  main_text?: string; // Para exibir rua em destaque
  secondary_text?: string; // Para exibir cidade/estado
  lat: string;
  lon: string;
  source: 'google' | 'osm';
}

export const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  onLocationSelect,
  disabled,
  placeholder,
  className
}) => {
  const [suggestions, setSuggestions] = useState<SuggestionResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown se clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  // Debounce logic para buscar na API
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      // Só busca se tiver mais de 3 caracteres e o menu estiver aberto
      if (value.length > 3 && isOpen) {
        setIsLoading(true);
        const apiKey = process.env.API_KEY;
        let googleSuccess = false;

        // 1. TENTATIVA GOOGLE GEOCODING (Prioridade)
        if (apiKey) {
            try {
                const googleRes = await fetch(
                    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(value)}&region=br&language=pt-BR&key=${apiKey}`
                );
                const googleData = await googleRes.json();

                if (googleData.status === 'OK' && googleData.results.length > 0) {
                    const mappedResults: SuggestionResult[] = googleData.results.map((item: any) => ({
                        place_id: item.place_id,
                        display_name: item.formatted_address,
                        main_text: item.address_components[0]?.long_name || item.formatted_address.split(',')[0],
                        secondary_text: item.formatted_address,
                        lat: item.geometry.location.lat.toString(),
                        lon: item.geometry.location.lng.toString(),
                        source: 'google'
                    }));
                    setSuggestions(mappedResults);
                    googleSuccess = true;
                }
            } catch (e) {
                // Silenciosamente falha para o fallback se a API Key não tiver permissão de Maps
                // console.warn("Google Geocoding indisponível, usando fallback.", e);
            }
        }

        // 2. FALLBACK OPENSTREETMAP (Nominatim)
        if (!googleSuccess) {
            try {
              const osmRes = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&addressdetails=1&limit=5&countrycodes=br`
              );
              const osmData = await osmRes.json();
              
              const mappedResults: SuggestionResult[] = osmData.map((item: any) => ({
                  place_id: item.place_id,
                  display_name: item.display_name,
                  main_text: item.address?.road || item.display_name.split(',')[0],
                  secondary_text: item.display_name,
                  lat: item.lat,
                  lon: item.lon,
                  source: 'osm'
              }));
              
              setSuggestions(mappedResults);
            } catch (error) {
              console.error("Erro ao buscar endereço (OSM):", error);
              setSuggestions([]);
            }
        }
        
        setIsLoading(false);
      } else if (value.length <= 3) {
        setSuggestions([]);
      }
    }, 300); // 300ms debounce (mais rápido)

    return () => clearTimeout(delayDebounceFn);
  }, [value, isOpen]);

  const handleSelect = (item: SuggestionResult) => {
    // Usa o nome formatado completo para preencher o input
    onChange(item.display_name);
    
    // Passa coordenadas para o pai se disponível
    if (onLocationSelect) {
        onLocationSelect(parseFloat(item.lat), parseFloat(item.lon));
    }

    setIsOpen(false);
    setSuggestions([]);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (!isOpen) setIsOpen(true);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => value.length > 2 && setIsOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
      />
      
      {/* Loading Indicator inside input */}
      {isLoading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin">
          <Loader2 size={16} />
        </div>
      )}

      {/* Dropdown Suggestions */}
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full bg-slate-800 border border-slate-700 rounded-lg mt-1 shadow-2xl max-h-60 overflow-y-auto custom-scrollbar animate-fadeIn">
          {suggestions.map((item) => (
            <li
              key={item.place_id}
              onClick={() => handleSelect(item)}
              className="px-4 py-3 hover:bg-slate-700 cursor-pointer border-b border-slate-700/50 last:border-none flex items-start gap-3 transition-colors text-left"
            >
              {item.source === 'google' ? (
                 <MapPin size={16} className="mt-1 text-red-500 shrink-0" />
              ) : (
                 <Globe size={16} className="mt-1 text-emerald-500 shrink-0" />
              )}
              <div className="overflow-hidden">
                <span className="text-slate-200 text-sm font-medium block truncate">
                   {item.main_text}
                </span>
                <span className="text-slate-400 text-xs block truncate">
                  {item.secondary_text}
                </span>
              </div>
            </li>
          ))}
          <li className="px-2 py-1 text-[10px] text-right text-slate-600 bg-slate-900/50 rounded-b-lg flex justify-between">
            <span>{suggestions[0]?.source === 'google' ? 'Google Maps' : 'OpenStreetMap'}</span>
            <span>VeriCorp Geo</span>
          </li>
        </ul>
      )}
    </div>
  );
};