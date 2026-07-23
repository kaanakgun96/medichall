import { CpvSelector } from "../../tenders/components/CpvSelector";
import {
  matchingCpvSelection,
  toggleMatchingCpvCode,
} from "../utils/map-company-profile";

type MatchingCpvSelectorProps = {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

export function MatchingCpvSelector({
  value,
  disabled,
  onChange,
}: MatchingCpvSelectorProps) {
  return (
    <CpvSelector
      value={value}
      onChange={onChange}
      inputId="matching-cpv-codes"
      inputDescriptionId="matching-cpv-description"
      placeholder="e.g. 33140000, 33169000"
      browseLabel="Browse catalog"
      selectedLabel="Selected matching CPV codes"
      selectedCodes={matchingCpvSelection(value)}
      onToggleCode={(code) => onChange(toggleMatchingCpvCode(value, code))}
      disabled={disabled}
    />
  );
}
