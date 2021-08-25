import { Test, TestingModule } from '@nestjs/testing';
import { Wsgateway } from './wsgateway';

describe('Wsgateway', () => {
  let provider: Wsgateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Wsgateway],
    }).compile();

    provider = module.get<Wsgateway>(Wsgateway);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });
});
