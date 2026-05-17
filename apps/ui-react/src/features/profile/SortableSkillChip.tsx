import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export type SkillRow = { clientId: string; name: string };

type Props = {
  skill: SkillRow;
  onNameChange: (name: string) => void;
  onRemove: () => void;
};

export function SortableSkillChip({ skill, onNameChange, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: skill.clientId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 py-1 pl-1 pr-1.5 dark:border-blue-700 dark:bg-blue-900/40 ${
        isDragging ? 'z-10 opacity-90 shadow-md' : ''
      }`}
    >
      <span
        className="material-icons cursor-grab select-none text-[14px] leading-none text-blue-400 active:cursor-grabbing dark:text-blue-500"
        {...attributes}
        {...listeners}
      >
        drag_indicator
      </span>
      <input
        type="text"
        placeholder="Skill"
        value={skill.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="min-w-[3rem] max-w-[10rem] w-20 border-0 bg-transparent p-0 text-sm text-blue-800 outline-none placeholder-blue-300 dark:text-blue-200 dark:placeholder-blue-600"
      />
      <button
        type="button"
        className="flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 leading-none text-blue-300 transition-colors hover:text-red-500 dark:text-blue-600 dark:hover:text-red-400"
        onClick={onRemove}
      >
        <span className="material-icons text-[14px] leading-none">close</span>
      </button>
    </div>
  );
}
