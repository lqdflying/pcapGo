import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HelpTooltip } from "@/components/HelpTooltip";

describe("HelpTooltip", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1024,
    });
  });

  function renderTooltip() {
    render(
      <HelpTooltip
        description="Network interface to capture packets on."
        usage="-i eth0"
      />,
    );

    return screen.getByRole("button", { name: "Show parameter help" });
  }

  it("shows tooltip content on keyboard focus", () => {
    const trigger = renderTooltip();

    fireEvent.focus(trigger);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Network interface to capture packets on.",
    );
    expect(screen.getByText("-i eth0")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-describedby");
  });

  it("shows tooltip content on click and dismisses on outside pointer", () => {
    const trigger = renderTooltip();

    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps clicked tooltip open when the pointer leaves the trigger", () => {
    const trigger = renderTooltip();

    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger);

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("keeps tooltip position on-screen in narrow viewports", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 120,
    });
    const trigger = renderTooltip();

    fireEvent.mouseEnter(trigger);

    expect(screen.getByRole("tooltip")).toHaveStyle({ left: "8px" });
  });

  it("dismisses tooltip content with Escape", () => {
    const trigger = renderTooltip();

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
