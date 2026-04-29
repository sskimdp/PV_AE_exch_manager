import "./SearchInput.css";

export function SearchInput({ value, onChange, placeholder = "Поиск" }) {
  return (
    <div className="search">
      <span className="search__icon" aria-hidden="true">
        <span className="search__circle" />
        <span className="search__stick" />
      </span>

      <input
        className="search__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
