declare namespace PIXI {
  class Application {
    constructor(options?: any);
    stage: Container;
    ticker: Ticker;
  }

  class Container {
    addChild(child: any): void;
  }

  class Graphics {
    beginFill(color: number): void;
    endFill(): void;
    drawCircle(x: number, y: number, radius: number): void;
    lineStyle(width: number, color: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    y: number;
  }

  class Ticker {
    add(fn: () => void): void;
  }
}