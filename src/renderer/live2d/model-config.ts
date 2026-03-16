export const DEFAULT_MODEL_NAME = 'Mao';

export function getModelJsonPath(modelName: string = DEFAULT_MODEL_NAME): string {
  return `../assets/models/${modelName}/${modelName}.model3.json`;
}

export function getModelLoadOptions(): { autoInteract: false } {
  return {
    autoInteract: false,
  };
}
