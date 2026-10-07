---
title: 'Velsat: Building the Software Behind a CanSat'
description: 'Turning sensor readings into radio telemetry, and learning what it takes to connect embedded code to a working team system.'
author: andrew
pubDate: '2026-10-07'
heroImage: '../../assets/velsat-software.svg'
topics: ['Embedded Software', 'Telemetry', 'Arduino']
---

A CanSat puts a surprisingly large software problem inside a very small physical space. For Velsat, our team needed to measure atmospheric conditions and particulate matter, then send readings to a ground station. The visible result was a small satellite-in-a-can project. My part was the embedded software and telemetry that connected the sensors to the rest of the system.

I worked on the code running alongside the sensors and the radio communication needed to get measurements off the CanSat. The wider project was a team effort, including the physical design, mission research, and ground-station display. This post focuses on the software I contributed and the practical lessons that came from joining those pieces together.

## Starting with a data path

The primary mission involved temperature and air-pressure measurements. Our secondary mission added particulate-matter sensing, with the aim of observing air quality alongside the other readings. From a software perspective, that meant handling several kinds of input rather than treating every sensor as if it returned the same thing.

The useful way to think about the system was as a path: read an input, interpret it, prepare the result, and transmit it. That sounds simple, but each step has its own assumptions. An analogue voltage is different from a structured reading received over a serial connection. A number printed to a local serial monitor is also different from a number that reaches a laptop over radio.

Breaking the problem into those stages made it easier to reason about what the embedded code was responsible for. It also gave us a shared description of how measurements should travel through the system, even when different people were working on different parts of the project.

## Making analogue readings meaningful

Our temperature sensor was an NTC thermistor. The software could read a voltage, but the mission needed a temperature. Bridging that gap meant working with calibration rather than assuming the raw input was already a useful measurement.

The team collected voltage and temperature pairs across a range of conditions. The report records readings taken while warming the setup and cooling it in a freezer. Those measurements gave us a relationship between voltage and temperature that could be used in the code. The fitted relationship documented in the report was `T = -16.3V + 49.5`.

That equation belonged to our particular calibration exercise. I would not treat it as a universal thermistor conversion, but it illustrates an important software lesson: the meaning of a value depends on how it was obtained. The code needs to express the assumptions behind a conversion, not just produce a plausible-looking number.

Pressure introduced another layer. The project used pressure measurements to estimate altitude, so units and the interpretation of the input mattered before any altitude calculation could be meaningful. The report contains exploratory formulas and sample code; I see those as part of the development record rather than a finished reference implementation to copy into another project.

## Integrating a serial sensor

The PMS5003 particulate-matter sensor required a different approach. Instead of reading an analogue pin and applying a calibration relationship, we used serial communication and a library that understood the sensor's data.

Our Arduino work used `Adafruit_PM25AQI` and `SoftwareSerial`. The first helped us work with the particulate sensor's readings. The second made it possible to use additional digital pins for serial communication, which was useful when several parts of the system needed connections.

Using a library removed some low-level work, but it did not remove the need to understand the interface. Pin assignments, initialisation, and the connection between the sensor's transmit line and the Arduino's receive line still mattered. The project flowchart reflected that setup work: define the libraries and variables, configure the serial communication, then initialise the sensor interface.

The team's measurement and display work also evolved. The regional version focused on PM2.5, while the later report describes expanding the immediate display to include more particulate sizes. That display was part of our shared system, rather than something I would claim to have built alone. For my embedded work, the important point was making the sensor information available for the next stage.

## Getting readings beyond the serial monitor

Radio telemetry was where a local software demonstration had to become a connection between two separate places. We used a pair of APC220 modules: one with the CanSat and one connected to the ground-station laptop.

Getting them working was not immediately straightforward. The report describes compatibility problems with newer devices and drivers, followed by driver updates and radio configuration. We configured a baud rate of 9600 and a frequency of 434 MHz, then tested communication between the modules.

This was a useful reminder that software troubleshooting sometimes starts outside the application code. A program can be ready to send data while the surrounding communication setup is still wrong. Checking the host connection, drivers, and matching radio settings was part of getting the telemetry path working.

The team also tested communication over increasing distances and changed the antenna arrangement after finding the supplied antennas inconsistent. Those physical changes helped the overall communication system, but they were team hardware work. My software takeaway was that a successful short-range test does not automatically establish how the whole system will behave in a different setting.

## What I took from Velsat

Velsat helped me understand embedded development as a chain of interfaces. The sensor has an interface to the code, the code has an interface to the radio, and the received information has an interface to the team's ground-station work. A problem at any one of those boundaries can look like a problem somewhere else.

It also made calibration and configuration feel less like background details. They are part of the software's behaviour. A reading without a clear conversion or a transmitter without matching communication settings is not enough to complete the task.

The most valuable part of my contribution was learning to connect those stages: interpreting sensor inputs, integrating a serial device, and getting telemetry to leave the embedded system. The project gave that code a concrete purpose, and working with the team made the boundary between my contribution and the larger result just as important as the code itself.
