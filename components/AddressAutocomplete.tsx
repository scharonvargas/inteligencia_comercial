import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Loader2 } from 'lucide-react';

interface AddressAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    road?: string;
    suburb?: string;
    city?: string;
    state?: string;
    postcode?: string;
  };
}

export const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  disabled,
  placeholder,
  className
}) => {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
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
      // Só busca se tiver mais de 3 caracteres e o menu estiver aberto (evita busca ao selecionar)
      if (value.length > 3 && isOpen) {
        setIsLoading(true);
        try {
          // Busca no Nominatim (Brasil focado, mas aceita outros)
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&addressdetails=1&limit=5&countrycodes=br`
          );
          const data = await response.json();
          setSuggestions(data);
        } catch (error) {
          console.error("Erro ao buscar endereço:", error);
          setSuggestions([]);
        } finally {
          setIsLoading(false);
        }
      } else if (value.length <= 3) {
        setSuggestions([]);
      }
    }, 500); // 500ms delay

    return () => clearTimeout(delayDebounceFn);
  }, [value, isOpen]);

  const handleSelect = (item: NominatimResult) => {
    // Formata o endereço de forma limpa para o input
    // Tenta pegar Rua + Bairro + Cidade ou o display_name completo se falhar
    let formatted = item.display_name;
    
    // Tentar criar um formato curto mais amigável: "Rua X, Bairro Y, Cidade - UF"
    if (item.address) {
        const parts = [];
        if (item.address.road) parts.push(item.address.road);
        if (item.address.suburb) parts.push(item.address.suburb);
        if (item.address.city) parts.push(item.address.city);
        else if (item.address.state) parts.push(item.address.state);
        
        if (parts.length >= 2) {
            formatted = parts.join(", ");
        }
    }

    onChange(formatted);
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
              <MapPin size={16} className="mt-1 text-brand-500 shrink-0" />
              <div>
                <span className="text-slate-200 text-sm font-medium block">
                   {item.address.road || item.display_name.split(',')[0]}
                </span>
                <span className="text-slate-400 text-xs block truncate max-w-[250px] md:max-w-md">
                  {item.display_name}
                </span>
              </div>
            </li>
          ))}
          <li className="px-2 py-1 text-[10px] text-right text-slate-600 bg-slate-900/50 rounded-b-lg">
            Dados © OpenStreetMap contributors
          </li>
        </ul>
      )}
    </div>
  );
};
