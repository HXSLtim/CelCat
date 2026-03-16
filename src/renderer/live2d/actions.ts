export interface Live2DAction {
  name: string;
  execute(model: any): void;
}

export class ExpressionAction implements Live2DAction {
  constructor(public name: string, private expression: string) {}

  execute(model: any): void {
    if (model?.expression) {
      model.expression(this.expression);
    }
  }
}

export class MotionAction implements Live2DAction {
  constructor(public name: string, private motionGroup: string) {}

  execute(model: any): void {
    if (model?.motion) {
      model.motion(this.motionGroup);
    }
  }
}

export class ParameterAction implements Live2DAction {
  constructor(
    public name: string,
    private paramName: string,
    private value: number
  ) {}

  execute(model: any): void {
    if (model?.internalModel?.coreModel) {
      const index = model.internalModel.coreModel.getParameterIndex(this.paramName);
      model.internalModel.coreModel.setParameterValueByIndex(index, this.value);
    }
  }
}

export const LIVE2D_ACTIONS = {
  expressions: [
    new ExpressionAction('happy', 'exp_01'),
    new ExpressionAction('sad', 'exp_02'),
    new ExpressionAction('surprised', 'exp_03'),
    new ExpressionAction('angry', 'exp_04'),
    new ExpressionAction('shy', 'exp_05'),
    new ExpressionAction('sleepy', 'exp_06'),
    new ExpressionAction('excited', 'exp_07'),
    new ExpressionAction('confused', 'exp_08')
  ],
  motions: [
    new MotionAction('idle', 'Idle'),
    new MotionAction('tap', 'TapBody')
  ],
  parameters: [
    new ParameterAction('lookLeft', 'ParamAngleX', -30),
    new ParameterAction('lookRight', 'ParamAngleX', 30),
    new ParameterAction('lookUp', 'ParamAngleY', -30),
    new ParameterAction('lookDown', 'ParamAngleY', 30),
    new ParameterAction('eyeLeft', 'ParamEyeBallX', -1),
    new ParameterAction('eyeRight', 'ParamEyeBallX', 1),
    new ParameterAction('eyeUp', 'ParamEyeBallY', -1),
    new ParameterAction('eyeDown', 'ParamEyeBallY', 1)
  ]
};