INSERT INTO machines(id,name,type,location) VALUES
('MCH-001','Atlas Press','Hydraulic press','Assembly · Zone A'),
('MCH-002','Nova Turbine','Gas turbine','Power · Zone B'),
('MCH-003','Orion Pump','Centrifugal pump','Cooling · Zone C'),
('MCH-004','Vega Compressor','Air compressor','Utilities · Zone A'),
('MCH-005','Helix CNC','CNC milling','Machining · Zone D');
INSERT INTO simulation_controls(machine_id) SELECT id FROM machines;
INSERT INTO thresholds(metric,warning,critical) VALUES ('temperature',80,95),('pressure',9,12),('vibration',5,8),('power',75,95);
INSERT INTO ingestion_health(id) VALUES(1);
